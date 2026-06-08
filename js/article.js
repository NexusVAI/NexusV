const articleData = {
    hero: {
        overlay: 'Technical Report 0524',
        media: { type: 'image', src: 'Logo/TR-0524.png', alt: 'Technical Report 0524' },
        zh: {
            title: '技术报告 0524：堵住 SSE 流式取消的成本漏洞',
            date: '2026年5月24日',
            category: '技术',
            readTime: '12 分钟阅读',
            paragraphs: [
                '摘要：今天我们公开一份内部技术报告，详细记录我们在 NexusV 网关中关闭的一个 P0 级别成本规避漏洞。该漏洞允许攻击者通过中途断开流式连接来逃避为已生成 token 付费，从而无限制地消耗后端推理资源。本次修复已部署至 <code>api-gateway v337</code> 与 <code>chat-gateway v551</code>，全部五项端到端测试通过。',
                '<strong>背景：流式 API 的特殊性</strong>',
                '当客户端通过 stream:true 发起对话请求时，网关会与上游模型之间建立一条 SSE（Server-Sent Events）长连接，并将每个 token 实时转发给客户端。这种模式提供了打字机式的流畅体验，却也引入了普通 JSON API 所没有的复杂性：响应"完成"的时间点、客户端"断开"的时间点、网关"停止读取上游"的时间点，三者完全可以分离。',
                '在我们之前的实现里，token 计费逻辑只在 SSE 流自然结束时触发——具体而言，是在 <code>TransformStream.flush</code> 回调中。这是一个看起来合理的位置：所有 token 都已经流出，最后一帧 usage 数据也已经被解析。但这个设计有一个致命假设：它假设客户端会读到流末。',
                '<strong>攻击面</strong>',
                '设想以下场景：用户向网关发起一个流式请求，模型预计将生成 8000 个输出 token。在前 200 毫秒内，用户收到了前 100 个 token，然后调用 <code>AbortController.abort()</code> 主动断开。从客户端角度看，请求被取消了。但从上游角度看：我们传给上游 fetch 的 AbortController 仅挂了超时定时器，并未与传入的客户端 signal 关联——上游因此会继续生成完整的 8000 token，而这些 token 由我们替用户付费给上游供应商。',
                '与此同时，网关本侧的 SSE TransformStream 因客户端断流而不会调用 flush()，导致 usage 结算逻辑永远不触发。占位预扣留下的 1 个 token 仍留在 <code>cancri_consume_paid_quota_v2</code> 记录里，但实际生成的 7999 token 永远不会入账到用户的月度配额上。',
                '一个熟悉 AbortController 行为的攻击者可以在几行代码内编写一个脚本：每 200 毫秒发起一个流式请求、读一个 token、立即 abort——他可以在不被任何配额闸门拦截的情况下，无限消耗我们的后端推理预算。',
                '<strong>三个互相关联的漏洞</strong>',
                '审计过程中我们识别出三个互相关联、但需要分别修复的根因。',
                '<strong>漏洞 #1：SSE flush-only 结算。</strong>计费逻辑只在 <code>TransformStream.flush</code> 中触发；客户端断流时 flush 不会被调用，结算永远不发生。',
                '<strong>漏洞 #2：上游 fetch 不响应客户端 signal。</strong><code>forwardToProxy</code> 内部的 AbortController 仅挂了超时定时器，没有与传入的 <code>req.signal</code> 链接。客户端断流后，上游继续生成；我们仍在为这些 token 向上游付费。',
                '<strong>漏洞 #3：SSE 槽位在响应构造时就被释放。</strong>三条 SSE 路由（OpenAI Chat、Anthropic Messages、Responses API）的 <code>finally { releasePreflightSlots() }</code> 在 <code>new Response(stream)</code> 返回后立即执行，但 SSE 流还在后台继续流。这意味着一个 API key 实际可以并发打开数倍于配置上限的流，绕过 <code>maxConcurrent: 2</code> 的限制。',
                '<strong>设计目标</strong>',
                '在着手实现修复前，我们明确了四条设计目标。',
                '其一，任何流终止路径都必须触发恰好一次结算。这包括：完整读完、客户端主动 cancel、上游错误、req.signal abort、底层 socket 错误——任何一种情况下，usage 都应该被记录、槽位都应该被释放。',
                '其二，结算逻辑必须是幂等的。同一个流的 settle 即使被并发触发多次，账单也不应该被重复记账，槽位也不应该被重复释放。',
                '其三，客户端断开必须传播到上游。否则我们仍在为客户端不会接收的 token 付费——这本身就是一种"我方支付，对方使用"的资源浪费。',
                '其四，对现有 SSE 转换逻辑的改动应当最小。OpenAI 到 Anthropic、OpenAI 到 Responses 这两条转换链路经过长时间验证，不应该被推翻重写。',
                '<strong>解决方案：bindStreamSettlement</strong>',
                '我们引入了一个通用 helper，命名为 <code>bindStreamSettlement&lt;T&gt;(upstream, onSettle, clientSignal?)</code>。它接受任意 ReadableStream 作为输入，返回一个新的 ReadableStream，承诺 onSettle 回调在四条终止路径中恰好被触发一次：reader 读到 done=true（graceful close）、消费方调用 cancel（downstream cancel）、reader.read() 抛错（上游错误）、传入的 AbortSignal 触发（client abort）。',
                '内部的 <code>settled</code> 标志位与 <code>settleOnce</code> 闭包保证了幂等性：即使所有四条路径同时触发，onSettle 也只会运行一次。这一性质对于结算逻辑至关重要——usage 记账、配额扣减、槽位释放，每一个都必须严格 exactly-once。',
                '将 helper 与三条流式路由集成时，我们做了两处配套重构。首先，三个 SSE transformer（<code>makeChatCompletionSseTransform</code>、<code>transformChatStreamToAnthropic</code>、<code>transformChatStreamToResponses</code>）从"内部 onUsage 回调在 flush 时调用"改为"暴露 snapshot() getter，返回当前累积的 usage"。其次，路由层维护两个 once 闭包：<code>releaseOnce</code>（释放槽位）和 <code>settleOnce</code>（记录 usage 加结算配额）。流式分支在返回 Response 前，将原始 SSE 流通过 bindStreamSettlement 包装，<code>onSettle</code> 回调里同时调用 snapshot()、settleOnce(...)、releaseOnce()。<code>finally</code> 分支改为 <code>if (!streamingHandover) releaseOnce()</code>——非流式路径仍由 finally 释放，流式路径把所有权交给 bindStreamSettlement 内部触发。',
                '<strong>上游 abort 的传播</strong>',
                'api-gateway 的 <code>forwardToProxy</code> 与 chat-gateway 的 <code>fetchWithTimeout</code> 都新增了一个可选的 <code>clientSignal</code> 参数。当客户端 signal 触发 abort 时，内部的 AbortController 也会触发 abort，从而立即关闭上游 fetch。监控侧我们区分了两种 AbortError：client-disconnect（响应 HTTP 499，客户端主动断开，无需当作错误处理）与 upstream timeout（响应 HTTP 504，上游真的没有在窗口内返回首字节）。这一区分让线上面板可以正确地把"用户主动取消"与"上游异常"分桶统计。',
                '<strong>部署</strong>',
                '本次修复涉及 NexusV 网关的两个边缘函数。',
                'api-gateway 部署为 v337，状态 ACTIVE。影响范围覆盖三条 OpenAI 兼容路由：<code>POST /v1/chat/completions</code>、<code>POST /v1/messages</code>（Anthropic Messages 协议）、<code>POST /v1/responses</code>（OpenAI Responses 协议）。',
                'chat-gateway 部署为 v551，状态 ACTIVE。影响范围覆盖 <code>wrapResponseForQuotaRecording</code> 包装的所有 chat 流式调用，即站内 ChatAI 用户走的全部模型对话路径。',
                '部署通过 Supabase Management API 的 multipart 上传端点完成，每个函数一次原子部署。整个改动不涉及 git 工作流——所有源代码修改均通过 IDE 直接编辑，部署后 HTTP 201 的响应携带新版本号与 ezbr 校验和，作为版本追踪凭证。',
                '<strong>端到端验证</strong>',
                '我们设计了一个五项主测试套件，目标是同时覆盖正常路径与异常路径：第一项查询 /v1/models 验证函数响应正常；第二项发起非流式 POST 请求验证 JSON 结算路径；第三项发起完整流式请求并读取到流末，观察到 196 个 chunks、34KB 数据、[DONE] 帧与最终 usage 帧均正确出现；第四项发起流式请求、读取首个 chunk 后立即 abort，验证 AbortError 正确传播且 reader 优雅退出；第五项在 abort 之后立即再发一次请求，验证网关未被卡死。5/5 PASS。',
                '我们还跑了一个突发模拟攻击：连续 5 次"发起流式 → 读 1 chunk → abort"，然后发起一次正常请求。结果是 4/5 断流按预期成功；1/5 命中上游 timeout 504（被 <code>settleOnce(504, 0, 0, 0)</code> 正确触发 refund），紧接其后的正常请求 4 秒返回 200 / 929 字节，网关全程未卡死。这次意外的 upstream timeout 反而验证了修复在另一条故障路径上的正确性：当上游真的失败时，槽位与配额仍被正确释放，下一次请求可以立刻进入。',
                '<strong>经验</strong>',
                '回顾整个过程，我们沉淀出三条对未来开发同样适用的工程经验。',
                '其一，任何"流"都至少有四条不同的退出路径——别只防其中一条。当我们最初编写 SSE 转换逻辑时，flush() 看起来是个明显的"结束钩子"，但它只覆盖一种情况。可观测的网关必须显式枚举所有终止路径。',
                '其二，跨函数传递 AbortSignal 不是"可选的优化"，而是构建可观测网关的基础设施。任何外发 fetch 都应该链接到调用方的 signal——否则你就在为不被消费的工作付费。',
                '其三，<code>settleOnce</code> 类型的幂等闭包是 SSE 网关的必备模式。我们已经把"任何新增的流式端点都必须从一开始就使用 snapshot() 加 bindStreamSettlement 加 signal 链接三件套"写进了内部代码评审清单。',
                '<strong>时间线</strong>',
                '2026-05-23 21:30 — 审计中发现漏洞 #1。',
                '2026-05-23 22:00 至 23:30 — 实现 <code>bindStreamSettlement</code>，重构三个 transformer，并同步修复漏洞 #2 与 #3。',
                '2026-05-23 23:30 — api-gateway v337 与 chat-gateway v551 上线。',
                '2026-05-23 23:45 — 5/5 端到端测试通过，突发攻击测试覆盖额外的上游失败路径。',
                '2026-05-24 00:10 — 本技术报告发布。',
                '—— NexusV 安全团队'
            ]
        },
        en: {
            title: 'Technical Report 0524: Closing the SSE Stream-Cancel Cost Loophole',
            date: 'May 24, 2026',
            category: 'Technical',
            readTime: '12 min read',
            paragraphs: [
                'Abstract: Today we publish an internal technical report documenting a P0 cost-evasion vulnerability we recently closed in the NexusV gateway. The vulnerability allowed an adversary to evade payment for already-generated tokens by abruptly disconnecting a streaming connection, enabling effectively unlimited consumption of backend inference resources. The fix has been deployed as <code>api-gateway v337</code> and <code>chat-gateway v551</code>, and all five end-to-end tests passed.',
                '<strong>Background: Why streaming APIs are different</strong>',
                'When a client opens a chat request with stream:true, the gateway establishes a long-lived Server-Sent Events (SSE) connection to the upstream model and forwards each token to the client in real time. This provides a fluid typewriter experience, but it also introduces complexity absent from ordinary JSON APIs: the moment a response is "complete", the moment a client "disconnects", and the moment the gateway "stops reading the upstream" are three distinct points in time.',
                'In our previous implementation, token-billing logic fired only when the SSE stream ended gracefully — specifically inside the <code>TransformStream.flush</code> callback. That placement seemed reasonable: every token had already flowed out, and the final usage frame had been parsed. But the design carried a fatal assumption — it assumed the client would read to the end of the stream.',
                '<strong>The attack surface</strong>',
                'Consider the following scenario. A user opens a streaming request expected to generate 8,000 output tokens. Within the first 200 ms, the user receives 100 tokens and then calls <code>AbortController.abort()</code>. From the client perspective, the request is cancelled. But from the upstream perspective, the AbortController we attach to the upstream fetch carried only a timeout — it was not linked to the inbound client signal. The upstream therefore continues generating all 8,000 tokens, all of which we pay for on behalf of the user.',
                'Meanwhile, on the gateway side, the SSE TransformStream does not invoke flush() when the client disconnects mid-stream. The settlement logic therefore never runs. The pre-deducted placeholder of 1 token remains in <code>cancri_consume_paid_quota_v2</code>, but the actual 7,999 tokens generated never enter the user\'s monthly quota ledger.',
                'An attacker familiar with AbortController behavior could write a handful of lines that, every 200 ms, opens a streaming request, reads one chunk, and aborts. Without tripping any quota gate, they would consume our inference budget without bound.',
                '<strong>Three interrelated bugs</strong>',
                'Auditing the system, we identified three interrelated root causes that needed independent fixes.',
                '<strong>Bug #1: Flush-only settlement.</strong> Billing fired only in <code>TransformStream.flush</code>; flush never runs when the client disconnects mid-stream, so the settle never happens.',
                '<strong>Bug #2: Upstream fetch ignores the client signal.</strong> The internal AbortController in <code>forwardToProxy</code> was wired only to a timeout. It was never linked to the inbound <code>req.signal</code>. After a client disconnect, the upstream continues to generate, and we continue to pay.',
                '<strong>Bug #3: SSE slot released too early.</strong> The <code>finally { releasePreflightSlots() }</code> block on the three SSE routes (OpenAI Chat, Anthropic Messages, Responses API) ran immediately after <code>new Response(stream)</code> returned, while the stream was still flowing in the background. This meant a single API key could open arbitrarily many concurrent streams, bypassing the configured <code>maxConcurrent: 2</code> limit.',
                '<strong>Design goals</strong>',
                'Before writing the fix, we set out four design goals.',
                'First, any termination path must trigger exactly one settlement. This covers reading to end, downstream cancel, upstream error, signal abort, and underlying socket failures — any of them.',
                'Second, settlement must be idempotent. Even if multiple termination paths fire concurrently for the same stream, billing must not double-charge, and slots must not be double-released.',
                'Third, a client disconnect must propagate to the upstream. Otherwise we are paying for tokens the client will never receive — a form of waste where we pay and someone else benefits.',
                'Fourth, the change to existing SSE conversion logic should be minimal. The OpenAI-to-Anthropic and OpenAI-to-Responses pipelines have been validated by months of production traffic; we did not want to rewrite them.',
                '<strong>The solution: bindStreamSettlement</strong>',
                'We introduced a generic helper named <code>bindStreamSettlement&lt;T&gt;(upstream, onSettle, clientSignal?)</code>. It takes any ReadableStream as input and returns a new ReadableStream that guarantees the onSettle callback fires exactly once across four terminal paths: the reader returning done=true (graceful close), the consumer calling cancel (downstream cancel), reader.read() throwing (upstream error), and the provided AbortSignal firing (client abort).',
                'An internal <code>settled</code> flag and a <code>settleOnce</code> closure guarantee idempotency. Even if all four paths fire concurrently, onSettle executes only once. This property is critical because settlement carries three exactly-once obligations: recording usage, deducting quota, and releasing the concurrency slot.',
                'Integrating the helper with the three streaming routes required two complementary refactors. First, the three SSE transformers (<code>makeChatCompletionSseTransform</code>, <code>transformChatStreamToAnthropic</code>, <code>transformChatStreamToResponses</code>) moved from an internal onUsage callback (called inside flush) to an exposed snapshot() getter that returns the currently accumulated usage. Second, the route layer maintains two once-style closures: <code>releaseOnce</code> (slot release) and <code>settleOnce</code> (usage record + quota settle). Before returning the Response, the streaming branch wraps the raw SSE body in bindStreamSettlement and arranges the onSettle callback to call snapshot(), then settleOnce(...), then releaseOnce(). The route-level <code>finally</code> becomes <code>if (!streamingHandover) releaseOnce()</code> — non-streaming paths still release via finally, while streaming paths hand ownership of the slot to bindStreamSettlement.',
                '<strong>Propagating abort to the upstream</strong>',
                'Both <code>forwardToProxy</code> in api-gateway and <code>fetchWithTimeout</code> in chat-gateway gained an optional <code>clientSignal</code> parameter. When the client signal fires, the internal AbortController also fires, closing the upstream fetch immediately. We also took the opportunity to disambiguate two flavors of AbortError in the error handler: client-disconnect (HTTP 499; the client walked away, not an error) versus upstream timeout (HTTP 504; the upstream genuinely failed to return a first byte in time). This lets our monitoring panel bucket "user cancelled" separately from "upstream failure".',
                '<strong>Deployment</strong>',
                'The fix spans two edge functions in the NexusV gateway.',
                'api-gateway was deployed as v337, ACTIVE. It covers three OpenAI-compatible routes: <code>POST /v1/chat/completions</code>, <code>POST /v1/messages</code> (Anthropic Messages protocol), and <code>POST /v1/responses</code> (OpenAI Responses protocol).',
                'chat-gateway was deployed as v551, ACTIVE. It covers every streaming chat call routed through <code>wrapResponseForQuotaRecording</code>, which is the entire model-conversation path used by ChatAI users in the web UI.',
                'Deployment used the Supabase Management API multipart endpoint, one atomic upload per function. The change touched no git workflow — all source modifications were performed via direct IDE edits, and the HTTP 201 deployment responses (carrying the new version number and ezbr checksum) serve as our deployment receipts.',
                '<strong>End-to-end verification</strong>',
                'We assembled a five-step main test suite that exercises both normal and abnormal paths: (1) a query to /v1/models confirming the function is alive; (2) a non-streaming POST validating the JSON settlement path; (3) a streaming request read to completion, where we observed 196 chunks, 34 KB of data, and both [DONE] and the final usage frame; (4) a streaming request followed by abort after reading one chunk, where AbortError propagated cleanly and the reader exited gracefully; (5) an immediate follow-up request confirming the gateway was not wedged. All five passed.',
                'We also ran a burst-attack simulation: five back-to-back "open stream, read one chunk, abort" cycles, followed by one normal request. The result was four successful aborts; one upstream timeout (504) that <code>settleOnce(504, 0, 0, 0)</code> refunded correctly; and a final normal request that returned 200 / 929 bytes in 4 seconds. The accidental upstream timeout actually validated the fix on a second failure path: when the upstream fails for real, slots and quota are correctly released, and the next request enters immediately.',
                '<strong>Lessons</strong>',
                'Looking back at the work, three engineering lessons stand out.',
                'First, any "stream" has at least four distinct exit paths — do not defend only one of them. When we originally wrote the SSE conversion logic, flush() looked like an obvious "end hook", but it covers only one case. Observability-grade gateways must enumerate every termination path explicitly.',
                'Second, passing AbortSignal across function boundaries is not an "optional optimization" — it is foundational infrastructure for observable gateways. Any outbound fetch should be linked to the caller\'s signal; otherwise you are paying for work nobody will consume.',
                'Third, an idempotent settleOnce closure is a required pattern for SSE gateways. We have written it into our internal review checklist: any new streaming endpoint must adopt the snapshot() + bindStreamSettlement + signal-chaining trio from day one.',
                '<strong>Timeline</strong>',
                '2026-05-23 21:30 — Bug #1 identified during routine audit.',
                '2026-05-23 22:00 to 23:30 — <code>bindStreamSettlement</code> implemented; three SSE transformers refactored; bugs #2 and #3 fixed concurrently.',
                '2026-05-23 23:30 — api-gateway v337 and chat-gateway v551 went live.',
                '2026-05-23 23:45 — End-to-end suite passed (5/5); burst test additionally validated the upstream-failure path.',
                '2026-05-24 00:10 — This technical report published.',
                '— The NexusV Security Team'
            ]
        }
    },
    chatai: {
        overlay: 'ChatAI',
        media: { type: 'image', src: 'Logo/chatAI.png', alt: 'ChatAI' },
        zh: {
            title: '隆重推出 ChatAI 多模型聚合平台',
            date: '2026年5月3日 16:00',
            category: '产品',
            readTime: '15 分钟阅读',
            paragraphs: [
                '今天，我们正式发布 ChatAI——一个以邮箱验证码登录、注册即可上手的 AI 聚合服务平台。ChatAI 将来自全球 14 家以上供应商的 40+ 顶尖大语言模型整合到一个简洁优雅的对话界面中，让每一位用户都能在统一界面下体验最前沿的 AI 对话能力。无论你需要写作辅助、代码调试、数据分析还是创意灵感，ChatAI 都能为你提供一站式解决方案。',
                '为什么要做 ChatAI？',
                '当前 AI 行业的现状是：优秀的模型分散在各个平台，每个平台都有自己的注册流程、计费方式和使用限制。用户想要对比不同模型的表现，需要在多个平台之间反复切换，既繁琐又低效。ChatAI 的诞生就是为了解决这个问题——一个入口，所有模型，统一体验。我们相信，AI 技术的普惠不应该被复杂的接入流程所阻挡。',
                '海量模型，一站聚合',
                'ChatAI 接入了来自全球 14 家以上供应商的 40+ 大语言模型，覆盖当前主流的几乎所有顶尖 AI：',
                '• DeepSeek 系列：DeepSeek-V4-Flash（默认模型，极速稳定）、DeepSeek-V4-Pro（专业研究级）、DeepSeek-R1（强大推理能力）等 7 款模型。',
                '• OpenAI / GPT 系列：GPT-5.4（通用旗舰）、GPT-OSS 120B（开源大参数模型）。',
                '• Anthropic Claude 系列：Claude Opus 4.6（长文写作首选）、Claude Sonnet 4.6（均衡全能）。',
                '• Google Gemini 系列：Gemini 3 Flash Preview 等模型。',
                '• 阿里 Qwen 系列：Qwen 3.5（多模态全能）、Qwen3-Max（多模态旗舰）、Qwen3-Coder（编程专家）等 7 款模型。',
                '• 月之暗面 Kimi 系列：Kimi K2.5、Kimi K2.6（超复杂编程）等 6 款模型。',
                '• 智谱 GLM 系列：GLM-5（深度编程）、GLM-5.1（复杂代码处理）、GLM-4.7（顶级推理）等 5 款模型。',
                '• xAI Grok 系列：Grok Code Fast 1（编程专注）、Grok Imagine（图像生成）。',
                '• 更多模型：MiniMax M2.7、Step-3.5 Flash、Spark-X2、Nemotron-3-Super、Ling 2.6、MiMo-V2.5-Pro、HunYuan3 Preview 等。',
                '每个模型都标注了速度等级（绿色=极快、黄色=中等、红色=慢速）和能力标签（通用、编程、推理、写作等），方便你快速选择最适合的模型。当当前模型配额用尽时，系统会自动切换到最快的可用模型，对话不中断。',
                '统一体验，零门槛上手',
                'ChatAI 的核心对话功能为所有注册用户开放，打开即用。我们最大程度降低了使用门槛，让 AI 真正触手可及。每日配额在午夜自动刷新，配合智能自动切换机制，确保你的对话体验始终流畅。',
                '强大的对话管理',
                'ChatAI 提供了完整的对话管理系统：',
                '• 云端对话历史：对话记录通过 Supabase 云端同步，支持跨设备访问。你可以随时回顾、继续或删除历史对话。',
                '• 对话置顶与重命名：重要对话可置顶显示，支持自定义命名，告别混乱的对话列表。',
                '• 自动标题生成：系统根据你的首条消息自动生成对话标题，无需手动整理。',
                '• 128K 超长上下文：支持高达 128,000 tokens 的上下文窗口，轻松处理长文档、长对话。系统会实时显示上下文使用量（环形进度条），当使用率达到 92% 时自动进行智能压缩——由 AI 总结对话要点并开启新会话，确保连贯性不受影响。',
                '• 临时对话模式：开启临时对话后，对话不会被保存到历史记录，不会用于模型训练，关闭后即销毁。适合处理敏感或临时性内容。',
                '多模态输入与文件处理',
                'ChatAI 不仅仅是文字对话。它支持多种输入方式：',
                '• 图片上传：支持上传图片文件，多模态模型可直接理解图片内容并进行分析、描述或回答相关问题。',
                '• 文件上传：支持 PDF、TXT、DOC、DOCX、MD、JSON、CSV 等格式，单条消息最多附带 4 个文件，单文件最大 8MB。文件内容会被智能解析并注入对话上下文。',
                '• 语音输入：集成 Web Speech API，支持中文普通话实时语音转文字。点击麦克风按钮即可开始语音输入，松开自动发送。',
                '• 全屏输入模式：点击展开按钮可进入全屏编辑模式，适合撰写长文或复杂 Prompt。',
                'AI 图像生成',
                'ChatAI 内置了独立的图像生成模块。你可以通过文字描述生成高质量图片，支持三种尺寸比例：1:1（正方形）、9:16（竖版海报）、16:9（横版宽屏）。系统提供了快捷 Prompt 模板（产品海报、界面概念、App 图标、社交媒体封面），也支持完全自定义描述。生成的图片以画廊形式展示，点击即可查看大图。',
                '联网搜索与网页阅读',
                'ChatAI 具备联网能力，AI 可以自主调用以下工具：',
                '• 联网搜索：AI 可以自主搜索互联网，获取最新的公开信息（最多返回 10 条结果），让回答不再局限于训练数据。',
                '• 网页阅读：AI 可以直接读取指定 URL 的完整内容，适合分析文章、文档或网页信息。',
                '• 站内文章检索：AI 可以搜索和阅读 NexusV 站内的所有技术文章，为你提供精准的站内知识支持。',
                '这些工具由 AI 自主决定是否调用——当你的问题需要最新信息或外部资料时，AI 会自动搜索并整合结果，无需你手动操作。',
                'AI 竞技场：模型盲测对决',
                'ChatAI 独创了「AI 竞技场」功能——匿名双模型对决。你输入一个问题，系统随机分配两个模型匿名回答，你投票选出更好的一方。投票后才会揭晓模型身份。竞技场维护了排行榜系统，记录每个模型的胜率和排名，采用防刷票机制确保公正性。这是了解不同模型真实能力差异的最佳方式。',
                '个性化体验',
                'ChatAI 提供了丰富的个性化设置：',
                '• 四套主题：暖白（Light）、深黑（Dark）、暖金（Yellow）、冷蓝（Blue），满足不同审美偏好。',
                '• 四种强调色：绿色、琥珀色、珊瑚色、石板灰，自由搭配界面风格。',
                '• 多语言支持：界面支持简体中文、英文、日文，语音输入支持普通话、英语、粤语。',
                '• 智能问候语：首页问候语会根据时间段（早/中/晚/深夜）、工作日/周末以及你的昵称动态变化，每天都有新鲜感。',
                '• 消息朗读：AI 回答支持一键朗读（TTS），采用 MiMo V2.5 TTS 语音合成引擎，也可回退到浏览器内置语音。',
                '• Markdown 与数学公式：完整支持 Markdown 渲染（标题、代码块、表格、列表等）和 KaTeX 数学公式，技术讨论和学术写作毫无障碍。',
                '安全与隐私',
                '我们高度重视用户隐私与安全（完整条款见 <a href="privacy.html">隐私协议</a>）：',
                '• 对话历史云端存储：默认对话记录保存在 Supabase 数据库，支持跨设备同步与回看；你可随时删除单条对话。临时对话模式开启后不会写入历史。我们不会将对话内容用于训练自有模型。',
                '• 用量与反滥用：记录模型调用 token 数、时间戳等用量元数据（不含对话原文）用于配额与计费；登录后采集设备指纹 visitor_id 防范多账号刷配额；经你同意后才上报客户端错误遥测。',
                '• 无广告追踪 Cookie：不使用第三方广告追踪 Cookie；Cloudflare Turnstile 仅用于登录人机验证。',
                '• 加密传输：客户端经 HTTPS 访问 <code>chat.nexusvai.xyz</code>，推理请求转发至上游模型供应方。',
                '• 账户安全：邮箱 OTP 登录 + Turnstile 人机验证；检测到开发者工具打开时显示安全提醒。',
                '• 防滥用系统：内置行为风控、封禁与申诉机制，自动拦截自动化脚本与异常访问。',
                '• 敏感信息提醒：请勿在对话中输入身份证号、银行卡号、验证码等高度敏感信息。',
                '与 NexusV 套件的关系',
                'ChatAI 是一个完全独立的产品，与 NexusV 套件（TACTFR、NexusV 修改器、Sentience）没有功能上的关联。NexusV 套件是面向 GTA V 单机环境的游戏模组，而 ChatAI 是面向所有用户的通用 AI 对话服务。两者共享 NexusV 品牌，但在技术架构、功能定位和用户群体上完全独立。',
                '技术架构',
                'ChatAI 采用纯云端处理架构：前端通过 <code>chat.nexusvai.xyz</code>（Cloudflare Workers）接入，聊天推理网关（chat-gateway）与公开 API 网关（api-gateway）在边缘执行，流式 SSE 响应不经 Supabase 出站；认证、PostgreSQL 数据库、chat-history、user-memory 等仍由 Supabase 提供，其余路径由 Worker 透明反代。用户对话经网关转发至 60+ 上游线路，结果实时流式返回。客户端响应式设计，适配桌面、平板与移动设备。',
                '未来展望',
                'ChatAI 当前为 Beta 阶段，我们将持续迭代优化。后续计划包括：接入更多 AI 模型、完善视频生成能力、增强 API 与项目协作等。开放 API 已上线，详见 <a href="chat/api_docs.html">API 文档</a>。我们致力于将 ChatAI 打造为最便捷、最开放的 AI 聚合平台。',
                '立即体验：打开 ChatAI 即刻开始与 AI 对话。一个入口，所有模型，统一体验。',
                '—— NexusV 团队'
            ]
        },
        en: {
            title: 'Introducing ChatAI — Multi-Model AI Aggregation Platform',
            date: 'May 3, 2026 16:00',
            category: 'Product',
            readTime: '15 min read',
            paragraphs: [
                'Today, we officially launch ChatAI — an AI aggregation service that brings 40+ top-tier large language models from over 14 global providers into a single clean conversational interface. Whether you need writing assistance, code debugging, data analysis, or creative inspiration, ChatAI is your one-stop solution under a unified experience.',
                'Why ChatAI?',
                'The current AI landscape is fragmented: excellent models are scattered across different platforms, each with its own registration process, billing method, and usage restrictions. Users who want to compare different models need to switch between multiple platforms repeatedly — tedious and inefficient. ChatAI was born to solve this: one entry point, all models, one unified experience.',
                'Massive Model Library, One Platform',
                'ChatAI connects to 40+ LLMs from over 14 global providers, covering virtually every top-tier AI model available today:',
                '• DeepSeek Series: DeepSeek-V4-Flash (default, fast/stable), DeepSeek-V4-Pro (research grade), DeepSeek-R1 (strong reasoning), and more — 7 models total.',
                '• OpenAI / GPT Series: GPT-5.4 (flagship general), GPT-OSS 120B (open-source large model).',
                '• Anthropic Claude Series: Claude Opus 4.6 (long-form writing champion), Claude Sonnet 4.6 (balanced all-rounder).',
                '• Google Gemini Series: Gemini 3 Flash Preview, and more.',
                '• Alibaba Qwen Series: Qwen 3.5 (multimodal), Qwen3-Max (multimodal flagship), Qwen3-Coder (coding specialist) — 7 models.',
                '• Moonshot Kimi Series: Kimi K2.5, Kimi K2.6 (super-complex coding) — 6 models.',
                '• Zhipu GLM Series: GLM-5 (deep programming), GLM-5.1 (complex code), GLM-4.7 (top reasoning) — 5 models.',
                '• xAI Grok Series: Grok Code Fast 1 (coding-focused), Grok Imagine (image generation).',
                '• And More: MiniMax M2.7, Step-3.5 Flash, Spark-X2, Nemotron-3-Super, Ling 2.6, MiMo-V2.5-Pro, HunYuan3 Preview, and more.',
                'Each model displays speed ratings (green=fast, yellow=medium, red=slow) and capability tags (general, coding, reasoning, writing) for quick selection. When a model\'s quota is exhausted, the system auto-switches to the fastest available model — your conversation never interrupts.',
                'Unified Experience, Zero Onboarding Friction',
                'ChatAI\'s core conversation features are open to every signed-in user, ready to use the moment you arrive. Daily quotas refresh at midnight, and intelligent auto-switching keeps your experience smooth even when individual model quotas run out.',
                'Powerful Conversation Management',
                'ChatAI provides a complete conversation management system:',
                '• Cloud History: Conversations sync via Supabase cloud, accessible across devices. Review, continue, or delete any time.',
                '• Pin & Rename: Pin important conversations, custom naming — no more messy lists.',
                '• Auto Titles: System generates conversation titles from your first message automatically.',
                '• 128K Context Window: Supports up to 128,000 tokens — handle long documents and extended conversations with ease. Real-time context usage meter shows capacity; auto-compression at 92% usage summarizes and starts fresh sessions seamlessly.',
                '• Temporary Chat Mode: Enable temporary chats that aren\'t saved to history, aren\'t used for training, and are destroyed when closed. Perfect for sensitive or ad-hoc queries.',
                'Multimodal Input & File Processing',
                'ChatAI goes beyond text. It supports multiple input methods:',
                '• Image Upload: Upload images for multimodal models to analyze, describe, or answer questions about.',
                '• File Upload: Supports PDF, TXT, DOC, DOCX, MD, JSON, CSV — up to 4 files per message, 8MB each. Content is intelligently parsed and injected into context.',
                '• Voice Input: Integrated Web Speech API for real-time Chinese speech-to-text. Tap the mic button to speak, release to send.',
                '• Fullscreen Input: Expand to fullscreen editing mode for long-form writing or complex prompts.',
                'AI Image Generation',
                'ChatAI includes a dedicated image generation module. Generate high-quality images from text descriptions in three aspect ratios: 1:1 (square), 9:16 (portrait), 16:9 (landscape). Quick prompt templates (product poster, interface concept, app icon, social media cover) are provided, along with fully custom descriptions. Generated images display in a gallery with click-to-expand.',
                'Web Search & Page Reading',
                'ChatAI has internet connectivity. The AI can autonomously invoke these tools:',
                '• Web Search: Search the internet for the latest public information (up to 10 results), so answers aren\'t limited to training data.',
                '• Page Reading: Directly read the full content of any specified URL — perfect for analyzing articles, documents, or web pages.',
                '• On-site Article Search: Search and read all NexusV technical articles for precise in-site knowledge support.',
                'The AI decides when to call these tools automatically — when your question requires current information or external sources, it searches and integrates results without any manual effort from you.',
                'AI Arena: Anonymous Model Battles',
                'ChatAI features a unique "AI Arena" — anonymous dual-model battles. Enter a question, and two randomly assigned models answer anonymously side by side. Vote for the better answer, then reveal the model identities. A leaderboard tracks win rates and rankings with anti-script voting protection. This is the best way to discover the true capability differences between models.',
                'Personalized Experience',
                'ChatAI offers rich personalization options:',
                '• Four Themes: Warm White (Light), Deep Black (Dark), Warm Gold (Yellow), Cool Blue (Slate).',
                '• Four Accent Colors: Green, Amber, Coral, Slate — mix and match freely.',
                '• Multi-language: UI supports Chinese, English, Japanese; voice input supports Mandarin, English, Cantonese.',
                '• Smart Greetings: Homepage greetings change dynamically based on time of day, weekday/weekend, and your nickname.',
                '• Read Aloud: One-click TTS for AI responses using MiMo V2.5 TTS engine, with browser speech fallback.',
                '• Markdown & Math: Full Markdown rendering (headings, code blocks, tables, lists) and KaTeX math formulas for technical and academic writing.',
                'Security & Privacy',
                'We take your privacy and security seriously (full terms: <a href="privacy.html">Privacy Policy</a>):',
                '• Cloud History: Conversations are stored in Supabase by default for cross-device sync; you can delete any thread. Temporary chat mode skips persistence. We do not train on your content.',
                '• Usage & Anti-Abuse: Token counts and call metadata (not message bodies) power quotas/billing; post-login device fingerprints deter multi-account abuse; client error telemetry only with your consent.',
                '• No Ad Tracking Cookies: No third-party ad tracking cookies; Cloudflare Turnstile is used for login CAPTCHA only.',
                '• Encrypted Transit: HTTPS to <code>chat.nexusvai.xyz</code>, then forwarding to upstream model providers.',
                '• Account Security: Email OTP login + Turnstile; DevTools-open warnings for script-injection awareness.',
                '• Anti-Abuse: Risk controls, bans, and appeals block automated scripts and abnormal access.',
                '• Sensitive Data Warning: Do not enter ID numbers, bank cards, or verification codes in chats.',
                'Relationship with NexusV Suite',
                'ChatAI is a completely independent product with no functional connection to the NexusV suite (TACTFR, NexusV Modifier, Sentience). The NexusV suite targets GTA V single-player game mods, while ChatAI is a universal AI dialogue service for all users. Both share the NexusV brand, but are entirely independent in architecture, positioning, and audience.',
                'Technical Architecture',
                'ChatAI is a pure cloud stack: the client hits <code>chat.nexusvai.xyz</code> (Cloudflare Workers) where chat-gateway and api-gateway run at the edge; streaming SSE bypasses Supabase egress. Auth, PostgreSQL, chat-history, and user-memory remain on Supabase, with other paths transparently proxied. Requests fan out to 60+ upstream routes and stream back in real time. Responsive UI for desktop, tablet, and mobile.',
                'Future Outlook',
                'ChatAI is in Beta. Upcoming work includes more models, better video generation, and richer API/project collaboration. The OpenAI-compatible API is already live — see <a href="chat/api_docs.html">API docs</a>. We aim to be the most convenient open AI aggregation platform.',
                'Try it now: Open ChatAI and start talking to AI immediately. One entry point, all models, one unified experience.',
                '— The NexusV Team'
            ]
        }
    },
    sentienceOriginal: {
        overlay: 'Infusing Life into San Andreas',
        media: { type: 'image', src: 'Logo/L1.webp', alt: 'Sentience Demo' },
        zh: {
            title: '赋予洛圣都数字灵魂',
            date: '2026年3月01日',
            category: '公司',
            readTime: '5 分钟深度阅读',
            paragraphs: [
                '2023 年，一个 AI 语音对话模组横空出世，顿时引起了全球《GTA5》模组社区的轰动与热议。彼时，虽然让玩家与 NPC 进行语音互动的构想早已存在，但那个初代模组往往受限于必须调用外部 API Key、高昂的云端计费成本以及令人难以忍受的网络延迟。玩家每一次开口，都需要等待云端的响应，一旦网络波动或额度耗尽，沉浸感便瞬间破碎。正如梵高在世时其画作一文不值，LSPDFR 刚诞生时也仅仅有几人下载，技术的先驱者往往要在孤独中摸索，等待生态的成熟。我们见证了可能性的萌芽，却也痛感于依赖云端、受制于人的技术瓶颈。',
                '而在 2026 年的今天，站在游戏技术与人工智能深度融合的新节点，我们自豪地宣布：国人终于拥有了完全自主可控、无需联网、纯本地部署的 AI 语音对话模组——Sentience（意识）。我们坚信，真正的沉浸式体验，不应被一根网线所束缚，更不应因高昂的成本而将大多数玩家拒之门外。',
                'Sentience 的诞生，标志着我们正式突破了"云端依赖"的桎梏，进入了"本地智能"的新纪元。不同于 2023 年那些需要频繁请求 API 的半成品，Sentience 将先进的大语言模型与语音合成技术深度融合，并通过极致的算法优化，使其能够直接在玩家的主流消费级显卡上流畅运行。',
                '零延迟响应：无需等待云端回传，你的每一句台词、每一个指令，都能在毫秒间得到 NPC 的自然回应，真正实现了"所说即所得"的实时交互，让洛圣都的街头对话如同现实般流畅。',
                '无限免费使用：彻底告别了按 Token 计费的焦虑。无论你在游戏中与路人闲聊、向警官报案，还是策划一场"特殊行动"，所有的对话都无需额外费用，真正做到了"一次安装，永久畅享"。',
                '隐私与安全：所有对话数据仅存留于你的本地设备，无需上传至任何第三方服务器，彻底杜绝了隐私泄露的风险，让你的每一次游戏体验都安心无忧。',
                '这种技术范式的转移，正如当年 LSPDFR 从无人问津到成为必装模组一样，正在引发一场静默而深刻的革命。我们深知，Sentience 此刻或许也正站在那个起点——没有百万用户的簇拥，没有铺天盖地的宣传，它刚刚从开发者的实验室中走出，带着稚嫩却无比坚定的光芒，迎接第一批探索者的检验。',
                '我们没有百万用户的规模，但我们拥有百万分之一的初心。我们明白，任何伟大的技术，都始于一个微小的火种。LSPDFR 当年也仅有寥寥数人下载，但正是这星星之火，最终点燃了整个洛圣都的执法生态。Sentience 亦是如此，它承载的不仅是技术的突破，更是我们对国产游戏模组生态自主化的执着信念。',
                '今日，我们宣布 Sentience 模组正式向全球玩家免费开放下载，并已与国内多家游戏社区平台达成初步合作意向。我们将获得在推广、宣传方面的深度支持。',
                '通过这些合作，我们将进一步扩大在中文乃至全球模组社区的影响力，夯实技术迭代和用户反馈的闭环，并显著增强团队的持续开发能力。这将助力我们把前沿的本地化 AI 交互技术，带给全球范围内的更多 GTA 玩家、模组创作者及游戏社区。',
                '这种对技术与体验的追求，已在 Sentience 的内核中得到体现。它让每一位玩家都能拥有与 NPC 进行深度对话的能力。尽管目前周活跃用户数尚在起步阶段，但我们观察到，早期测试用户的平均游戏时长显著增加，他们正通过 Sentience 进行角色扮演、任务探索和即兴创作，而这些互动此前往往只能通过预设脚本或文字聊天实现。',
                '我们正步入一个新阶段：前沿 AI 正在从实验室研发走向游戏体验的深度赋能。未来的模组领导力将取决于谁能以足够快的速度优化本地性能以满足需求，并将其转化为玩家乐于沉浸其中的交互产品。Sentience 的诞生与本次社区合作，将助力我们双管齐下，加速实现"让每一次游戏对话都充满真实生命力"的使命。',
                'Sentience，不仅仅是一个模组，它是一扇门，一扇通往真正智能、真正沉浸的开放世界之门。我们或许没有百万用户，但我们坚信，每一个点击下载、每一次认真体验的你，都是这扇门后新世界的共同缔造者。加入我们，一起见证意识的觉醒。'
            ]
        },
        en: {
            title: 'Infusing Life into San Andreas',
            date: 'March 01, 2026',
            category: 'Company',
            readTime: '5 min read',
            paragraphs: [
                'In 2023, an AI voice dialogue mod emerged, instantly causing a sensation and discussion in the global "GTA5" modding community. At that time, although the concept of allowing players to interact with NPCs via voice had long existed, that early mod was often limited by the need to call external API Keys, high cloud billing costs, and unbearable network latency. Every time a player spoke, they had to wait for a cloud response. Once the network fluctuated or the quota was exhausted, the immersion was instantly shattered. Just as Van Gogh\'s paintings were worthless when he was alive, and LSPDFR had only a few downloads when it was first born, pioneers of technology often have to grope in solitude, waiting for the ecology to mature. We witnessed the budding possibilities, but also felt the pain of technical bottlenecks relying on the cloud and being controlled by others.',
                'Today, in 2026, standing at the new node of deep integration of game technology and artificial intelligence, we are proud to announce: Gamers finally have a fully autonomous, controllable, offline, and purely locally deployed AI voice dialogue mod - Sentience. We firmly believe that a true immersive experience should not be bound by a network cable, nor should it shut out most players due to high costs.',
                'The birth of Sentience marks our formal breakthrough of the shackles of "cloud dependence" and entry into a new era of "local intelligence". Unlike those semi-finished products in 2023 that required frequent API requests, Sentience deeply integrates advanced large language models with speech synthesis technology, and through extreme algorithm optimization, enables it to run smoothly directly on players\' mainstream consumer graphics cards.',
                'Zero Latency Response: No need to wait for cloud transmission. Every line and every instruction of yours can receive a natural response from the NPC in milliseconds, truly realizing real-time interaction of "what you say is what you get", making street conversations in Los Santos as smooth as reality.',
                'Unlimited Free Use: Completely say goodbye to the anxiety of billing by Token. Whether you are chatting with passers-by in the game, reporting a crime to a police officer, or planning a "special operation", all conversations require no additional fees, truly achieving "install once, enjoy forever".',
                'Privacy and Security: All dialogue data is stored only on your local device, without uploading to any third-party server, completely eliminating the risk of privacy leakage, making every game experience of yours worry-free.',
                'This shift in technological paradigm, just like LSPDFR going from obscurity to becoming a must-have mod, is triggering a silent and profound revolution. We know that Sentience may also be standing at that starting point at this moment - without the crowd of millions of users, without overwhelming publicity, it has just walked out of the developer\'s laboratory, with immature but incredibly firm light, welcoming the inspection of the first batch of explorers.',
                'We do not have the scale of millions of users, but we have the original intention of one in a million. We understand that any great technology starts with a tiny spark. LSPDFR only had a few downloads back then, but it was this spark that eventually ignited the entire law enforcement ecology of Los Santos. Sentience is the same. It carries not only a technological breakthrough but also our persistent belief in the autonomy of the domestic game mod ecology.',
                'Today, we announce that the Sentience mod is officially open for free download to players worldwide, and we have reached preliminary cooperation intentions with multiple domestic game community platforms. We will receive in-depth support in promotion and publicity.',
                'Through these collaborations, we will further expand our influence in the Chinese and even global modding communities, consolidate the closed loop of technology iteration and user feedback, and significantly enhance the team\'s continuous development capabilities. This will help us bring cutting-edge localized AI interaction technology to more GTA players, mod creators, and game communities worldwide.',
                'This pursuit of technology and experience has been embodied in the core of Sentience. It allows every player to have the ability to have in-depth conversations with NPCs. Although the number of weekly active users is currently in the initial stage, we have observed that the average game time of early test users has increased significantly. They are conducting role-playing, mission exploration, and impromptu creation through Sentience, and these interactions could previously only be achieved through preset scripts or text chat.',
                'We are entering a new stage: cutting-edge AI is moving from laboratory R&D to deep empowerment of game experience. Future mod leadership will depend on who can optimize local performance fast enough to meet demand and transform it into an interactive product that players are willing to immerse themselves in. The birth of Sentience and this community cooperation will help us work along both lines to accelerate the realization of the mission of "making every game conversation full of real vitality".',
                'Sentience is not just a mod; it is a door, a door to a truly intelligent and truly immersive open world. We may not have millions of users, but we firmly believe that every one of you who clicks to download and experiences it seriously is a co-creator of the new world behind this door. Join us and witness the awakening of consciousness together.'
            ]
        }
    },
    n1: {
        overlay: 'Cancri',
        media: { type: 'image', src: 'Logo/Cancri.png', alt: 'Cancri Research' },
        zh: {
            title: 'Cancri：跨检查点的隐状态接力机制',
            date: '2026年4月28日',
            category: '研究',
            readTime: '12 分钟阅读',
            paragraphs: [
                '我们提出隐状态接力（latent relay）机制——通过在微调检查点边界之间直接传递隐藏状态来链式调用语言模型专家，完全绕过词元空间的通信瓶颈。与传统多智能体工作流（将连续表征压缩为离散词元）不同，隐状态接力每个序列仅传输约 30KB 的张量，完整保留了中间表征的全部维度信息。',
                '研究背景与动机',
                '当前多模型协作的主流范式是"词元中介的多智能体协作"：模型 A 生成自然语言输出，模型 B 将其作为提示接收。这种方法实现简单，但造成了严重的信息瓶颈。一个 2B 参数模型的前向传播在每层都通过高维连续流形传播信息；强制这些信息通过词汇量大小的 softmax，再重新嵌入生成的词元——几乎丢弃了所有无法通过离散化幸存的信息。',
                '混合专家（MoE）架构虽然避免了这一瓶颈，但要求所有专家子网络同时驻留内存，峰值显存随专家数量线性增长。我们提出第三条路径：隐状态接力。专家 A 在输入序列上执行前 K 层变换器层，然后将隐藏状态张量写入缓冲区；专家 B 被加载入内存（同时 A 被逐出），读取该张量并从第 K 层继续推理。接力负载仅为一个形状为 ℝ^(1×L×d_model) 的浮点张量，当 L=20、d_model=2048 时仅约 30KB——在任何存储介质上都是可忽略的 I/O 开销。',
                '核心创新：RoPE 微调不变性',
                '我们证明了旋转位置编码（RoPE）在微调下具有不变性：如果两个模型共享相同的架构规范，则它们的 RoPE 参数（head_dim、base）完全相同，因此接收方可以独立从位置索引重新计算位置编码。这意味着最小接力负载仅为隐藏状态张量本身，无需额外元数据。',
                '在 Qwen3.5-2B Base 与 Instruct 检查点上的实验验证了该命题——所有 24 个分割点上 ρ_A 与 ρ_B 的最大差异为 0.00e+00，实现了数学意义上的精确一致。',
                '实验结果与性能分析',
                '我们在 Qwen3.5-2B 模型族上进行了系统性实验（Base → Instruct 跨检查点接力），主要发现如下：',
                '单步预测困惑度：在三个评估文本上，接力机制的平均困惑度比最优基线仅高 0.7%，在英语文本上甚至优于两个基线（PPL 9.09 vs A=10.10/B=9.61）。',
                '自回归生成（20 词元）：平均困惑度比 Instruct 基线低 5.1%（ratio=0.949），在机器学英语文本上达到 PPL 2.11（vs A=2.34, B=2.14）。',
                '词元一致性：100 个生成词元中 47% 实现三重一致（relay=A=B），62% 与 Instruct 基线对齐，33% 为"独立生成"——但这不代表质量下降，而是隐状态空间插值产生的创造性融合。',
                '语义连贯性：所有五个提示（涵盖量子计算、生命意义、AI 发展、斐波那契代码、科幻创作）均生成语义连贯的文本，无灾难性退化。',
                '分割点选择的三段式结构',
                '通过逐层分析隐藏状态发散度 δ_i = ‖h^(i)_A - h^(i)_B‖_∞，我们发现了 Base→Instruct 的三段式结构：',
                '稳定区（层 0-1）：δ_i < 0.20，cos > 0.98。微调对低级特征提取影响最小。',
                '过渡区（层 2-15）：δ_i ∈ [0.53, 1.06]，cos ∈ [0.96, 0.99]。逐渐发散。',
                '发散区（层 16-23）：δ_i ∈ [2.0, 4.5]，cos ≈ 0.96。SFT/RLHF 对这些后期层影响最大。',
                '基于这一结构，我们建议在稳定区（K ≤ 6）内分割以最大化与接收方输出分布的对齐，或在过渡区内分割以实现受控混合。所有主要实验采用 K=6。',
                '内存优势与工程实现',
                '隐状态接力的最大工程价值在于内存效率：无论链中有多少个专家，峰值内存始终等于一个模型加负载张量（约 30KB）。这与 MoE 架构形成鲜明对比——后者需要同时加载所有专家。',
                '具体执行流程：加载模型 A；执行层 0:K；写入负载；逐出模型 A；加载模型 B；读取负载；执行层 K:N；逐出模型 B。在 2B 参数模型上，这意味着可以用单模型内存运行任意长度的专家链，代价是顺序加载的延迟开销。',
                '可复现性保证',
                '本研究提供完整的 NeurIPS 2026 Phase 4 可复现包（链接<a href="https://huggingface.co/datasets/xingy555888/cancri-latent-relay" target="_blank" rel="noopener noreferrer">https://huggingface.co/datasets/xingy555888/cancri-latent-relay</a>），包含：实验脚本（run_phase4_extended_safe.py）、精确提示与 PPL 评估文本（phase4_prompts.json）、验证过的结果表格（table3_phase4_ppl.csv）。实验在 Intel Core i5-10400 CPU（float32）上完成，通过子进程隔离保证模型间内存完全回收。',
                '研究局限与未来方向',
                '当前工作存在以下局限：仅验证同架构检查点（Qwen3.5-2B）间的兼容性，跨架构接力需要训练投影层；实验规模为 2B 参数模型，结果可能在更大规模（7B+）或不同精度（bfloat16）下有所不同；自回归实验仅覆盖 20 词元，更长序列可能出现误差累积；未在 MMLU、GSM8K、HumanEval 等基准上评估下游任务性能。',
                '未来方向包括：带学习投影层的跨架构接力；三专家黑板调度（A→B→C）；基于输入内容的动态分割点选择；GPU 量化推理验证；以及大规模基准评估。',
                '结论',
                '隐状态接力为内存受限硬件上的多专家协作开辟了一条实用路径。我们的结果表明，同架构检查点共享结构上兼容的隐空间，可以被利用来实现低开销的专家组合。这项工作建立了可验证的工程基础，为无需词元空间通信的专家链式调用提供了理论与实践支撑。',
                '— NexusV 研究团队'
            ]
        },
        en: {
            title: 'Cancri: Cross-Checkpoint Latent Relay for Zero-Overhead Expert Chaining',
            date: 'April 28, 2026',
            category: 'Research',
            readTime: '12 min read',
            paragraphs: [
                'We propose latent relay, a mechanism for chaining language model experts by passing hidden states directly across fine-tuning checkpoint boundaries, bypassing token-space communication entirely. Unlike multi-agent workflows—which compress continuous representations into discrete tokens—latent relay transfers a ~30KB tensor per sequence, preserving the full dimensionality of the intermediate representation.',
                'Background and Motivation',
                'The dominant paradigm for combining multiple language models is text-mediated multi-agent collaboration: model A produces natural language output, which model B receives as its prompt. This approach is straightforward to implement but imposes a severe information bottleneck. A forward pass through a 2B-parameter model propagates information through a d_model-dimensional continuous manifold at every layer; forcing that information through a vocabulary-size softmax—and then re-embedding the resulting token—discards almost everything that does not survive discretization.',
                'Mixture-of-experts (MoE) architectures avoid this bottleneck but require all expert sub-networks to reside simultaneously in memory, scaling peak VRAM linearly with the number of experts. We propose a third path: latent relay. Expert A executes the first K transformer layers on an input sequence, then writes its hidden state tensor to a buffer. Expert B is loaded into memory (while A is evicted), reads the tensor, and continues inference from layer K. The relay payload is a single floating-point tensor of shape ℝ^(1×L×d_model); for L=20, d_model=2048, this amounts to roughly 30KB—a negligible I/O cost on any storage medium.',
                'Core Innovation: RoPE Invariance Under Fine-Tuning',
                'We prove that rotary positional embeddings (RoPE) are invariant to fine-tuning: if two models share the same architecture specification, their RoPE parameters (head_dim, base) are identical, enabling the receiver to recompute positional embeddings independently from position indices. This reduces the minimum relay payload to the hidden state tensor alone, with no additional metadata.',
                'Experiments on Qwen3.5-2B Base and Instruct checkpoints verify this proposition—observing max_diff = 0.00e+00 between ρ_A and ρ_B across all 24 split points, achieving mathematical exactness.',
                'Experimental Results and Performance Analysis',
                'We conducted systematic experiments on the Qwen3.5-2B model family (Base → Instruct cross-checkpoint relay), with the following key findings:',
                'Single-step prediction perplexity: Across three evaluation texts, the relay mechanism achieves perplexity within 0.7% of the best baseline, even outperforming both baselines on English text (PPL 9.09 vs A=10.10/B=9.61).',
                'Autoregressive generation (20 tokens): Average perplexity is 5.1% lower than the Instruct baseline (ratio=0.949), reaching PPL 2.11 on the Machine Learning English text (vs A=2.34, B=2.14).',
                'Token consistency: Of 100 generated tokens, 47% achieve tri-consistency (relay=A=B), 62% align with the Instruct baseline, and 33% are "independent"—but this does not indicate quality degradation; rather, it represents creative synthesis from latent space interpolation.',
                'Semantic coherence: All five prompts (covering quantum computing, meaning of life, AI development, Fibonacci code, and sci-fi creativity) produced semantically coherent text with no catastrophic degeneration.',
                'Three-Segment Split-Point Selection Structure',
                'Through layer-by-layer analysis of hidden state divergence δ_i = ‖h^(i)_A - h^(i)_B‖_∞, we discovered a three-segment structure for Base→Instruct:',
                'Stable zone (layers 0-1): δ_i < 0.20, cos > 0.98. Fine-tuning has minimal effect on low-level feature extraction.',
                'Transition zone (layers 2-15): δ_i ∈ [0.53, 1.06], cos ∈ [0.96, 0.99]. Gradual divergence.',
                'Divergence zone (layers 16-23): δ_i ∈ [2.0, 4.5], cos ≈ 0.96. SFT/RLHF most strongly reshape these late layers.',
                'Based on this structure, we recommend splitting within the stable zone (K ≤ 6) to maximize alignment with the receiver\'s output distribution, or within the transition zone for controlled blending. All primary experiments use K=6.',
                'Memory Advantages and Engineering Implementation',
                'The greatest engineering value of latent relay lies in memory efficiency: regardless of how many experts are in the chain, peak memory remains equal to one model plus the payload tensor (~30KB). This contrasts sharply with MoE architectures, which require loading all experts simultaneously.',
                'Concrete execution flow: Load model A; execute layers 0:K; write payload; evict model A; load model B; read payload; execute layers K:N; evict model B. On 2B-parameter models, this means running arbitrarily long expert chains with single-model memory, at the cost of sequential loading latency.',
                'Reproducibility Guarantee',
                'This research provides a complete NeurIPS 2026 Phase 4 reproducibility package (link <a href="https://huggingface.co/datasets/xingy555888/cancri-latent-relay" target="_blank" rel="noopener noreferrer">https://huggingface.co/datasets/xingy555888/cancri-latent-relay</a>), including: experimental scripts (run_phase4_extended_safe.py), exact prompts and PPL evaluation texts (phase4_prompts.json), and verified result tables (table3_phase4_ppl.csv). Experiments were conducted on Intel Core i5-10400 CPU (float32), with subprocess isolation ensuring complete memory recovery between models.',
                'Limitations and Future Directions',
                'Current work has the following limitations: compatibility is only verified between same-architecture checkpoints (Qwen3.5-2B); cross-architecture relay would require trained projection layers; experiments were conducted at 2B-parameter scale, and results may differ at larger scales (7B+) or different precision (bfloat16); autoregressive experiments only cover 20 tokens, and longer sequences may exhibit error accumulation; downstream task performance on benchmarks like MMLU, GSM8K, and HumanEval has not been evaluated.',
                'Future directions include: cross-architecture relay with learned projection layers; three-expert blackboard scheduling (A→B→C); dynamic split-point selection conditioned on input content; GPU quantized inference validation; and large-scale benchmark evaluation.',
                'Conclusion',
                'Latent relay opens a practical path for multi-expert collaboration on memory-constrained hardware. Our results suggest that same-architecture checkpoints share a structurally compatible latent space that can be exploited for low-overhead expert composition. This work establishes a verifiable engineering foundation, providing both theoretical and practical support for expert chaining without token-space communication.',
                '— NexusV Research Team'
            ]
        }
    },
    n2: {
        overlay: 'TACTFR',
        media: { type: 'image', src: 'Logo/download.jfif', alt: 'TACTFR V5' },
        zh: {
            title: '了解 TACTFR V5',
            date: '2026年3月03日',
            category: '文档',
            readTime: '12 分钟阅读',
            paragraphs: [
                'TACTFR V5：当 GTA5 遇见真实执法——一次把"不确定性"写进代码的迭代实验',
                '我在洛圣都当过"警察"。你可能也当过。',
                '你会熟悉那种违和感：嫌疑人被我喝止后像脚本触发一样僵住；或者反过来，他卡在车门上、状态机错位，场面像是系统和系统打架。那一刻我意识到：我们缺的不是"更多动作"，而是更可信的行为逻辑。',
                'TACTFR V5 想回答的其实是一个更难的问题：',
                '能不能用代码模拟真实执法的核心——不确定性？',
                '从 2026 年 1 月 19 日 5.0.0 发布，到 2 月 24 日 5.3.100 推出，我们在 37 天内完成了 17 次迭代。我们并不是在堆功能，而是在持续校准一个目标：什么才会让执法模拟变得可信。',
                '1. 先把地基打牢：从重构开始',
                '5.0.0 是一次"重新开始"的版本。我们主动回收了前作 4.0.5 中大量临时拼接的实现，优先偿还技术债。',
                '这意味着：一些功能会暂时消失，但系统会变得可依赖。',
                '在这次重构里，我们首先解决了最影响体验的基础问题：',
                '案件无法结束、流程卡死；状态不同步导致的逻辑分叉；嫌疑人死亡后流程停滞；任务清理不彻底带来的连锁异常。',
                '这些修复看起来琐碎，但它们决定了后续所有系统能否稳定运行。只有当底层是确定的，我们才有资格在上层引入"可控的不确定性"。',
                '2. 让嫌疑人成为"人"：性格系统与概率分布',
                '执法模拟的难点从来不在"警察能做什么"，而在"嫌疑人会做什么"。',
                '真实世界里，你面对的是人的判断、恐惧、冲动与误判，而不是固定脚本。我们需要的不是一个"是否攻击玩家"的开关，而是一套能表达差异与波动的模型。',
                '因此在 5.0.99，我们引入了性格系统：以行为概率为核心，让嫌疑人在相同情境下仍可能做出不同选择。',
                '更重要的是，我们把"过度反抗"当作 bug 来修。因为在现实中，反抗是小概率事件；如果每次都反抗，那不是"刺激"，而是"失真"。我们的目标是模拟概率分布，不是制造固定结果。',
                '到 5.2.0，这套系统被进一步细化为更清晰的风险分档与触发链路：',
                '追车嫌疑人按普通/中危/高危生成；拒停逃逸按概率触发，而非必然触发；持枪默认高危；停稳下车后，中危/高危存在概率暴力反抗。',
                '这带来的体验变化很直接：作为执法者，我永远无法预知下一秒会发生什么。而这，正是执法的真实感来源。',
                '3. 把"丢失目标"变成玩法：搜索范围圈与资源换信息',
                '嫌疑人丢失，是执法模拟里最难做真实的场景之一。传统做法要么让嫌疑人"消失"，要么让他"瞬移回视野"。两者都在破坏可信度。',
                '5.3.0 我们引入了搜索范围圈机制：',
                '目标丢失后，地图上出现红色半透明圆圈；圆圈表达"大致位置"，不再提供精确定位；玩家必须在圈内搜索，重新发现后才恢复精确红点。',
                '这让追捕从"锁定目标"变成"管理不确定性"：我知道他大概在哪，但我必须用路线、视野和判断把他找出来。',
                '同时，我们加入了"直升机勘探"：我可以在调度菜单呼叫直升机协助搜索，系统会用短信样式回报发现结果。',
                '这不是为了降低难度，而是为了引入更像真实世界的选择：用资源换信息，用时间换空间。',
                '4. 两种案件形态，但同一套行为内核',
                '5.2.0 的自由终端系统让玩家可以选择两类任务模式：',
                '步行嫌疑人案件：强调近距离互动与突然性；追车嫌疑人案件：强调高速决策与资源调度。',
                '这看起来是"玩法分叉"，但我们的设计目标恰恰相反：让它们共享同一套底层行为逻辑。',
                '无论是街角突然逃跑、钻进巷道躲藏，还是拒停逃逸、绕行、突然下车反抗，这些都由同一套机制驱动：',
                '性格分档决定倾向；概率触发制造波动；范围圈管理丢失与再发现。',
                '当一个统一的行为模型能够适配不同物理情境时，系统才会显得"像一个世界"，而不是"两个模式"。',
                '5. 真实感来自细节：我们用迭代消灭违和感',
                '如果说大系统决定"能不能玩"，那么小细节决定"像不像"。',
                '在 V5 的迭代日志里，最有价值的往往不是新增功能，而是那些持续被修正的违和点：',
                '5.0.1：修复嫌疑人上车抢驾驶位的问题——现实里嫌疑人会逃跑，但不会在警方面前以不合逻辑的方式"抢座位触发动画"；',
                '5.2.1：放宽 I 逼停指令距离，同时避免跨地图控制——我可以在合理范围内施压，但不能隔着街区"隔空执法"；',
                '5.3.99：车载终端（车内按 T）、特警服、雪糕筒（F7 菜单）——从核心流程到沉浸元素逐步补齐；',
                '5.3.100：新增巡逻案件，可自行执法与搜查路人——角色从"反应者"走向"维持者"，执法从事件触发走向持续存在。',
                '每一次修补，其实都在回答同一个问题：是什么让我突然想起"我在玩模组"？我们要做的，就是把这种提醒一次次抹掉。',
                '6. 评分系统：把执法反馈还给玩家',
                '5.0.1 我们加入了评分系统：满分 10 分，从"夯"到"拉"。',
                '它不是为了惩罚玩家，也不是为了把执法变成打分游戏。它更像一面镜子：在流程结束后，系统把我刚刚的选择变成可见的反馈——是否过度使用暴力、是否放跑嫌疑人、是否造成不必要伤亡。',
                '我们没有把它设计成强制约束，而是保留了空间：你可以不在乎分数，但分数会逼你思考——我刚才的执法，是否符合我想扮演的那种警察？',
                '7. 仍在路上：把洛圣都推近真实执法现场',
                '从 5.0.0 到 5.3.100，我们做的并不是"更大"，而是"更准"：',
                '稳定的底层让系统可依赖；性格与概率让互动不可预测但可解释；范围圈让丢失目标成为策略空间；多样案件形态共享同一行为内核；细节迭代持续消除违和感。',
                '截至 2026 年 2 月 24 日，最新版本 5.3.100 仅 102KB。在动辄数百 MB 的模组生态里，这个数字显得克制。但对我们来说，体积小不是目标，逻辑精炼才是：每一行代码都应该在做"让世界更可信"的事。',
                '下一个版本会带来什么？我们还没公开。但方向很明确：让洛圣都的街头，无限接近真实的执法现场。'
            ]
        },
        en: {
            title: 'Understanding TACTFR V5',
            date: 'March 03, 2026',
            category: 'Documentation',
            readTime: '12 min read',
            paragraphs: [
                'TACTFR V5: When GTA5 Meets Real Law Enforcement — An Iterative Experiment of Writing "Uncertainty" into Code',
                'I have been a "police officer" in Los Santos. You may have been too.',
                'You are familiar with that sense of dissonance: after I shout to stop, the suspect freezes like a script trigger; or conversely, he gets stuck in the car door, the state machine misaligns, and the scene looks like system fighting system. At that moment I realized: what we lack is not "more animations", but more credible behavioral logic.',
                'What TACTFR V5 wants to answer is actually a harder question:',
                'Can we use code to simulate the core of real law enforcement — uncertainty?',
                'From the release of version 5.0.0 on January 19, 2026, to version 5.3.100 on February 24, we completed 17 iterations in 37 days. We were not stacking features, but continuously calibrating one goal: what makes law enforcement simulation credible.',
                '1. Lay the Foundation First: Starting with Refactoring',
                '5.0.0 was a "fresh start" version. We actively reclaimed many temporarily patched implementations from the previous version 4.0.5 and prioritized paying off technical debt.',
                'This means: some features may temporarily disappear, but the system becomes reliable.',
                'In this refactoring, we first solved the basic problems that most affected the experience:',
                'Cases that could not end and processes that froze; logical divergence caused by state desynchronization; process stagnation after suspect death; and chain anomalies caused by incomplete task cleanup.',
                'These fixes may seem trivial, but they determine whether all subsequent systems can run stably. Only when the underlying layer is deterministic can we qualify to introduce "controllable uncertainty" at the upper layer.',
                '2. Make Suspects "Human": Personality System and Probability Distribution',
                'The difficulty of law enforcement simulation has never been about "what the police can do", but about "what the suspect will do".',
                'In the real world, you face human judgment, fear, impulses, and misjudgments, not fixed scripts. What we need is not a "whether to attack the player" switch, but a model that can express differences and fluctuations.',
                'Therefore, in version 5.0.99, we introduced the personality system: with behavioral probability as the core, suspects may still make different choices in the same situation.',
                'More importantly, we treated "excessive resistance" as a bug to fix. Because in reality, resistance is a low-probability event; if everyone resists every time, that is not "exciting", but "unrealistic". Our goal is to simulate probability distribution, not to create fixed results.',
                'By version 5.2.0, this system was further refined into clearer risk tiers and trigger chains:',
                'Pursuit suspects are generated as normal/medium-risk/high-risk; refusal to stop and escape is triggered by probability rather than inevitably; firearms are default high-risk; after stopping and getting out of the car, medium-risk/high-risk suspects have a probability of violent resistance.',
                'The resulting change in experience is direct: as a law enforcement officer, I can never predict what will happen in the next second. And this is exactly the source of the realism of law enforcement.',
                '3. Turn "Lost Target" into Gameplay: Search Radius and Resources for Information',
                'Losing a suspect is one of the hardest scenarios to make realistic in law enforcement simulation. Traditional approaches either make the suspect "disappear" or "teleport back into view". Both break credibility.',
                'In version 5.3.0 we introduced the search radius mechanism:',
                'After the target is lost, a red translucent circle appears on the map; the circle expresses an "approximate location" and no longer provides precise positioning; the player must search within the circle and precise red dot is restored only after rediscovery.',
                'This turns pursuit from "locking on to a target" into "managing uncertainty": I know roughly where he is, but I have to find him using routes, vision, and judgment.',
                'At the same time, we added "helicopter reconnaissance": I can call a helicopter in the dispatch menu to assist in the search, and the system will report the discovery result in SMS style.',
                'This is not to reduce the difficulty, but to introduce choices that are more like the real world: trade resources for information, trade time for space.',
                '4. Two Case Types, But the Same Behavioral Core',
                'The free terminal system in version 5.2.0 allows players to choose two types of mission modes:',
                'Foot suspect cases: emphasizing close-range interaction and suddenness; pursuit suspect cases: emphasizing high-speed decision-making and resource allocation.',
                'This looks like "gameplay divergence", but our design goal is exactly the opposite: to make them share the same underlying behavioral logic.',
                'Whether it is suddenly fleeing around a corner, ducking into an alley to hide, or refusing to stop and escape, circling, or suddenly getting out of the car to resist, these are all driven by the same mechanism:',
                'Personality tiers determine tendencies; probability triggers create fluctuations; radius circles manage loss and rediscovery.',
                'Only when a unified behavioral model can adapt to different physical situations will the system appear "like a world" rather than "two modes".',
                '5. Realism Comes from Details: We Eliminate Dissonance through Iteration',
                'If the big systems determine "whether it is playable", then the small details determine "whether it feels real".',
                'In the V5 iteration log, the most valuable things are often not new features, but those continuously corrected points of dissonance:',
                '5.0.1: Fixed the issue of suspects getting into the car to grab the driver seat — in reality suspects will run away, but they will not "grab the seat and trigger animation" in an illogical way in front of the police;',
                '5.2.1: Relaxed the I-stop command distance while avoiding cross-map control — I can apply pressure within a reasonable range, but I cannot "enforce across the street";',
                '5.3.99: In-vehicle terminal (press T in the car), SWAT uniform, traffic cones (F7 menu) — gradually completing from core processes to immersive elements;',
                '5.3.100: Added patrol cases, allowing self-enforcement and searching pedestrians — the role moves from "responder" to "maintainer", and law enforcement moves from event-triggered to continuous presence.',
                'Every repair is actually answering the same question: what makes me suddenly remember "I am playing a mod"? What we need to do is to erase this reminder again and again.',
                '6. Scoring System: Giving Law Enforcement Feedback Back to Players',
                'In version 5.0.1 we added a scoring system: full score of 10, from "awesome" to "terrible".',
                'It is not to punish players, nor to turn law enforcement into a scoring game. It is more like a mirror: after the process ends, the system turns my choices into visible feedback — whether I used excessive violence, whether I let the suspect escape, whether I caused unnecessary casualties.',
                'We did not design it as a mandatory constraint, but left room: you can ignore the score, but the score will force you to think — does the law enforcement I just performed match the kind of police officer I want to play?',
                '7. Still on the Road: Pushing Los Santos Closer to a Real Law Enforcement Scene',
                'From 5.0.0 to 5.3.100, what we did was not "bigger", but "more accurate":',
                'Stable underlying layer makes the system reliable; personality and probability make interactions unpredictable but explainable; radius circles turn lost targets into strategic space; diverse case types share the same behavioral core; detail iteration continuously eliminates dissonance.',
                'As of February 24, 2026, the latest version 5.3.100 is only 102KB. In a mod ecosystem that often runs into hundreds of MBs, this number seems restrained. But for us, small size is not the goal; logical refinement is: every line of code should be doing the job of "making the world more credible".',
                'What will the next version bring? We have not made it public yet. But the direction is clear: make the streets of Los Santos infinitely close to a real law enforcement scene.'
            ]
        }
    },
    tactfr540: {
        overlay: '',
        media: { type: 'video', src: 'Logo/TA1.mp4', poster: 'Logo/H1.webp', fit: 'cover', alt: 'TACTFR 5.6.0' },
        zh: {
            title: '介绍 TACTFR 5.6.0',
            date: '2026年3月26日',
            category: '产品',
            readTime: '10 分钟阅读',
            paragraphs: [
                '今天，我们正式推出 TACTFR 5.6.0。作为 GTA5 增强版平台上的核心执法模拟框架，这一次的更新代表了我们在构建高自由度、复杂且拟真的虚拟执法环境中的又一次重要演进。',
                '自 5.0.0 版本进行底层代码的彻底重构以来，我们的目标始终是：将单调的线性脚本指令，转化为具有"涌现性"的动态事件系统。在 5.6 版本中，我们不仅大幅降低了性能开销，还通过引入全新的自主战术实体与物理交互机制，进一步拓展了系统能力的边界。',
                '战术能力的自然延伸',
                '在复杂的现场环境中，执法者往往需要更智能的辅助与更多维的控制手段。5.6 版本在这方面实现了核心突破。',
                'K-9 自主战术警犬系统：基于意图识别的动态响应',
                '我们在 F7 调度框架中集成了 K-9 单元。这并非一个简单的跟随模型，而是一个具备环境感知与状态识别的独立逻辑实体。K-9 能够实时读取嫌疑人的行为意图（State Machine）——当系统判定嫌疑人触发"逃逸（Flight）"或"暴力拒捕（Fight）"状态时，K-9 将无需玩家下达额外指令，自动介入并实施物理压制。这为单人执法场景提供了关键的战术冗余。',
                '实战级破胎器（Spike Strips）：高保真的物理交互',
                '物理拦截一直是我们致力完善的模块。通过 F7 调度菜单，玩家现在可以部署最多 5 条战术钉刺带。我们为其重写了底层的物理碰撞检测机制（Collision Detection），当高速运动的逃逸车辆实体与钉刺带发生空间重叠时，系统将瞬时剥夺对应轮胎的抓地力参数，引发符合物理引擎逻辑的车辆失控。',
                '生化快检与行为树分支（DUI/Drug Testing）',
                '我们在 O 键巡逻框架中新增了酒精与毒品快检逻辑。这一功能的意义在于为常规巡逻注入了"不可预见性"。快检不仅是 UI 层面的反馈，它被深度绑定到了嫌疑人的行为树（Behavior Tree）中。阳性结果将作为高权重触发器，极大概率导致嫌疑人的状态发生剧烈转变（如当场拔枪或突发性逃逸）。玩家现在的每一次靠边停车（Traffic Stop），都可能是一次危险的动态博弈。',
                '底层重构与性能起飞',
                '任何复杂系统的拓展都离不开健壮的底层架构。随着从 5.1 的车载终端到 5.4 的电台语音系统的不断堆叠，系统开销曾一度成为瓶颈。',
                '在 5.6.0 版本中，我们对代码库进行了深度的清理与重构：',
                '帧率（FPS）表现的代际跃升：我们优化了大量高频调用的冗余逻辑，大幅降低了主线程的运算负担，彻底解决了过往版本中偶发的"卡顿"与"粘滞感"。',
                '动画状态机修复：修复了长期存在的"上拷动画卡死"问题。通过优化角色动画状态（Animation States）与逻辑状态的同步机制，拘捕流程的连贯性得到了系统级的保障。',
                '展望未来',
                '从 5.0 的"破而后立"，到 5.2 的终端自动化，再到今天 5.6 的多维度战术扩展，TACTFR 正在从一个单纯的"模组"，演变成一个可高度定制的虚拟警察沙盒框架。',
                '我们相信，未来的游戏体验不应是机械地触发脚本，而是玩家与一套拥有自我逻辑的系统之间的高级交互。我们将继续在这条道路上探索，为 TACTFR 带来更稳定的表现与更深度的机制。',
                'TACTFR 5.6.0 现已在增强版区开放下载（15.95MB）。',
                '感谢社区一路以来的反馈与支持。如遇未预期的问题，请继续通过日志系统向我们提交报告。'
            ]
        },
        en: {
            title: 'Introducing TACTFR 5.6.0',
            date: 'March 26, 2026',
            category: 'Product',
            readTime: '10 min read',
            paragraphs: [
                'Today, we officially release TACTFR 5.6.0. As the core law enforcement simulation framework on the GTA5 Enhanced Edition platform, this update represents another significant evolution in our mission to build a highly open, complex, and realistic virtual law enforcement environment.',
                'Since the complete底层代码重构 in version 5.0.0, our goal has been consistent: transforming monotonous linear script commands into dynamic event systems with "emergence." In version 5.6, we have not only significantly reduced performance overhead but also expanded the system\'s capability boundaries by introducing entirely new autonomous tactical entities and physical interaction mechanisms.',
                'Natural Extension of Tactical Capabilities',
                'In complex field environments, law enforcement officers often need smarter assistance and more dimensional control. Version 5.6 achieves core breakthroughs in this area.',
                'K-9 Autonomous Tactical Dog System: Intention-Based Dynamic Response',
                'We have integrated K-9 units into the F7 dispatch framework. This is not a simple follow model, but an independent logic entity with environmental awareness and state recognition. K-9 can now read suspects\' behavioral intentions in real-time (State Machine) —— when the system determines that a suspect has triggered "Flight" or "Fight" states, K-9 will automatically intervene and implement physical restraint without requiring additional commands from the player. This provides critical tactical redundancy for single-player law enforcement scenarios.',
                'Combat-Grade Spike Strips: High-Fidelity Physical Interaction',
                'Physical interception has always been a module we\'ve dedicated ourselves to perfecting. Through the F7 dispatch menu, players can now deploy up to 5 tactical spike strips. We have rewritten the underlying physical collision detection mechanism (Collision Detection). When a high-speed escaping vehicle entity spatially overlaps with the spike strip, the system will instantaneously deprive the corresponding tire\'s grip parameters, causing vehicle loss of control that complies with physics engine logic.',
                'Biochemical Quick Testing and Behavior Tree Branching (DUI/Drug Testing)',
                'We have added alcohol and drug quick-testing logic to the O-key patrol framework. The significance of this feature is to inject "unpredictability" into routine patrols. Quick testing is not merely UI-level feedback; it is deeply bound to the suspect\'s behavior tree. Positive results serve as high-weight triggers, very likely causing dramatic state changes in suspects (such as drawing a gun on the spot or suddenly attempting to flee). Every traffic stop for players now could be a dangerous dynamic game.',
                'Underlying Refactoring and Performance Leap',
                'Any complex system\'s expansion relies on robust underlying architecture. With the continuous stacking from version 5.1\'s vehicle terminal to 5.4\'s radio voice system, system overhead had once become a bottleneck.',
                'In version 5.6.0, we conducted deep cleaning and refactoring of the codebase:',
                'Generational Leap in Frame Rate (FPS) Performance: We optimized a large amount of high-frequency call redundant logic, significantly reducing the main thread\'s computational burden, completely solving the occasional "stuttering" and "stickiness" from past versions.',
                'Animation State Machine Fix: Fixed the long-standing "handcuff animation freeze" issue. Through optimizing the synchronization mechanism between character animation states and logic states, the coherence of the arrest process has received system-level assurance.',
                'Looking Ahead',
                'From 5.0\'s "break and rebuild," to 5.2\'s terminal automation, to today\'s 5.6 multi-dimensional tactical expansion, TACTFR is evolving from a simple "mod" into a highly customizable virtual police sandbox framework.',
                'We believe future gaming experiences should not mechanically trigger scripts, but rather represent advanced interactions between players and a system with self-logic. We will continue exploring this path, bringing more stable performance and deeper mechanics to TACTFR.',
                'TACTFR 5.6.0 is now available for download in the Enhanced Edition area (15.95MB).',
                'Thanks to the community\'s feedback and support along the way. If you encounter unexpected issues, please continue submitting reports through our logging system.'
            ]
        }
    },
    tactfr600: {
        overlay: '',
        media: { type: 'video', src: 'Logo/TA1.mp4', poster: 'Logo/TACTFR6.0.0.png', fit: 'cover', alt: 'TACTFR 6.0.0' },
        zh: {
            title: '隆重推出 TACTFR 6.0.0 Beta.2 测试版',
            date: '2026年4月25日',
            category: '产品',
            readTime: '10 分钟阅读',
            paragraphs: [
                '今天，我们很高兴地发布 TACTFR 6.0.0 Beta.2 预览版——这是我们对 GTA V 警务模组体验的又一次重要升级。',
                '故事任务系统',
                'Beta.2 引入了全新的故事任务框架。我们构建了一个分层的故事模块，支持完整的任务生命周期管理。对话系统现在支持打字机效果、角色语气着色、玩家选择分支以及信任度追踪，为沉浸式叙事提供了坚实基础。',
                '银行抢劫章节经过重新设计，从响应到达、现场对话、对峙僵局到双嫌疑人追捕、逮捕和事后处理，形成了一条完整的叙事链。我们添加了电影级开场镜头、场景单位调度和动态环境交互，让任务体验更加生动。',
                '逮捕与执法系统',
                '我们重构了逮捕序列系统，引入了七阶段流程（准备-接近-制服-等待-上铐-搜身-结束），随机选择四种动画变体，并配备了四组摄像机视角（侧面中景、骨骼跟随、肩后跟随、样条轨道）。慢动作效果在关键时刻增强戏剧张力。',
                '警官小队系统现在完美适配连续双嫌疑人逮捕。当第一名嫌疑人被制服后，小队会自动锁定下一名未制服的嫌疑人并继续执行逮捕链，无需玩家干预。追捕、接近、下车和上铐的可靠性得到了显著提升。',
                '终端与用户界面',
                '警察终端 UI 经过了全面重新设计。我们采用了更深邃的背景色调、更明亮的面板分区，并将右侧面板细分为嫌疑人信息、风险评估和战术建议三个区域。半透明蓝色高亮和层次分明的文字色调提升了可读性。',
                '配置系统现在支持深度自定义，包括终端 UI 主题颜色、背景/面板不透明度、提示矩形位置和大小、提示不透明度、信息流/上下文/帮助开关等。玩家可以根据自己的偏好调整界面。',
                '架构与性能',
                '我们在 V6 运行时架构上继续推进。PullOver 和 Patrol 系统已经迁移到纯 V6 战术切片，不再依赖遗留适配器。LegacyTacticalContextBridge 将遗留的 CaseManager 嫌疑人句柄和锁定状态镜像到 V6 SuspectRegistry 和 CaseDirector，确保平滑过渡。',
                '事件系统现在支持句柄过滤，避免全局状态污染。所有嫌疑状态都通过句柄隔离，清理必须在生成之前完成，确保系统稳定性。',
                '下一步',
                'Beta.2 预览版标志着 TACTFR 6.0.0 的又一个里程碑。我们正在继续优化嫌疑人 AI 行为、Sentience AI 集成以及 V6 运行时的完整性。你的反馈对我们至关重要。',
                '立即下载体验，并在我们的 QQ 群（1079691553/1061632354）分享你的想法。',
                '—— TACTFR 开发团队'
            ]
        },
        en: {
            title: 'Introducing TACTFR 6.0.0 Beta.2 Preview',
            date: 'April 25, 2026',
            category: 'Product',
            readTime: '10 min read',
            paragraphs: [
                'Today, we are thrilled to release TACTFR 6.0.0 Beta.2 Preview — another significant upgrade to our GTA V law enforcement mod experience.',
                'Story Mission System',
                'Beta.2 introduces a brand new story mission framework. We have built a layered story module that supports complete mission lifecycle management. The dialogue system now features typewriter effects, character tone coloring, player choice branches, and trust tracking, providing a solid foundation for immersive storytelling.',
                'The bank heist chapter has been redesigned from scratch, forming a complete narrative chain from dispatch response, on-scene dialogue, standoff deadlock, to dual suspect pursuit, arrest, and post-incident handling. We added cinematic opening shots, scene unit dispatch, and dynamic environmental interactions, making the mission experience more vivid.',
                'Arrest & Law Enforcement System',
                'We重构了逮捕序列系统，引入了七阶段流程（准备-接近-制服-等待-上铐-搜身-结束），随机选择四种动画变体，并配备了四组摄像机视角（侧面中景、骨骼跟随、肩后跟随、样条轨道）。慢动作效果在关键时刻增强戏剧张力。',
                'The officer squad system now perfectly supports consecutive dual-suspect arrests. When the first suspect is subdued, the squad automatically locks onto the next unarmed suspect and continues the arrest chain without player intervention. Pursuit, approach, vehicle exit, and cuffing reliability have been significantly improved.',
                'Terminal & User Interface',
                'The police terminal UI has been completely redesigned. We adopted a deeper background tone, brighter panel divisions, and subdivided the right panel into three areas: suspect information, risk assessment, and tactical suggestions. Semi-transparent blue highlights and layered text tones improve readability.',
                'The configuration system now supports deep customization, including terminal UI theme colors, background/panel opacity, hint rectangle position and size, hint opacity, info stream/context/help toggles, and more. Players can tailor the interface to their preferences.',
                'Architecture & Performance',
                'We continue to advance on the V6 runtime architecture. PullOver and Patrol systems have been migrated to pure V6 tactical slices, no longer relying on legacy adapters. LegacyTacticalContextBridge mirrors legacy CaseManager suspect handles and lock states to V6 SuspectRegistry and CaseDirector, ensuring a smooth transition.',
                'The event system now supports handle filtering, avoiding global state pollution. All suspect states are isolated by handle, and cleanup must be completed before generation, ensuring system stability.',
                'What Comes Next',
                'Beta.2 marks another milestone for TACTFR 6.0.0. We are continuing to optimize suspect AI behavior, Sentience AI integration, and V6 runtime completeness. Your feedback is essential to us.',
                'Download and play now, and share your thoughts in our QQ groups (1079691553 / 1061632354).',
                '— TACTFR Development Team'
            ]
        }
    },
    tactfr627: {
        overlay: 'TACTFR 6.0.0 Beta.2.7',
        media: { type: 'video', src: 'Logo/1mo.Cancri.mp4', poster: 'Logo/TACTFR6.0.0.png', fit: 'cover', alt: 'TACTFR 6.0.0 Beta.2.7' },
        zh: {
            title: '隆重推出 TACTFR 6.0.0 Beta.2.7 测试版',
            date: '2026年6月8日',
            category: '产品',
            readTime: '14 分钟阅读',
            paragraphs: [
                '摘要：今天我们发布 **TACTFR 6.0.0 Beta.2.7**——在 Beta.2 故事任务与七阶段逮捕管线之上，本版把嫌疑人行为、交付语义、双目标押送、UI 统一主题与 legacy 链路 Officer AI 全部推到可玩状态。版本号 <code>6.0.2.7</code>（信息版本 <code>TACTFR-6.0.0-BETA-2.7</code>），Release|x64 编译通过，QQ 群 1061632354。',
                '<strong>从 Beta.2 到 Beta.2.7：我们修了什么</strong>',
                'Beta.2 奠定了 6.0 的骨架：分层故事任务（银行抢劫完整叙事链）、七阶段电影化逮捕、警官小队连续双嫌逮捕、警察终端重绘，以及 PullOver / Patrol 纯 V6 战术切片。Beta.2.7 不再扩架构边界，而是把玩家能感知到的断裂点一条条焊死——嫌疑人刷不出来、双车上车不同步、交付后仍显示成功、逮捕镜头穿地、银行警车瞬移、菜单配色各写各的。',
                '<strong>嫌疑人行为：更像 GTA6 时刻</strong>',
                '武装嫌疑人在被瞄准施压时，可按概率进入<strong>假投降链</strong>：举手约 1.8 秒 → 放手转身约 0.7 秒 tell 窗口 → 掏枪反抗，走标准 <code>ForceResist</code> 战斗管线。未被瞄准时，每约 1.2 秒扫描活跃警力：civilian / nervous 仓惶逃跑并求饶；violent 转头戒备后撤；armed maniac 在警员逼近且持枪时有概率直接反击。',
                '扫描<strong>排除玩家自己的座驾</strong>——你开警车停在旁边不会误吓跑嫌犯。全部使用工程内已验证 native（<code>TASK_HANDS_UP</code>、<code>TASK_SMART_FLEE_COORD</code>、<code>PLAY_PED_AMBIENT_SPEECH_NATIVE</code> 等），唇形与内置语音同步，不依赖 LLM 服务器在线。',
                '新增 <strong>X 键嫌疑人语音互动</strong>（<code>SuspectVoiceInteract</code>，可在 TACTFR.ini 改绑）：按一次轮换命令呵斥 → 辱骂 → 安慰 → 闲聊。玩家警员用 <code>FORCE_SHOUTED</code> 真实吼出声；嫌犯按语气与性格做表情并内置语音回应。辱骂时暴力型怒怼，紧张型更恐惧并标记恐吓。',
                '<strong>交付与案件结算：语义终于对齐</strong>',
                '修复 <code>CaseManager.OnSuspectDelivered()</code> 异常后误完成案件的风险：异常记录日志并保守中止，不再静默落入 Completed。<code>MarkDelivered()</code> 返回是否真正标记成功。',
                '双嫌疑人边界采用方案 A：<strong>任一嫌疑人死亡或逃脱，最终不再显示完整「成功交付」</strong>，分别按 <code>SuspectDead</code> / <code>Failed</code> 结算。<code>DeliverSystem</code> 缓存委托，<code>Shutdown()</code> 对称退订并清理等待下车过渡态。',
                '<strong>双目标押送与逮捕镜头</strong>',
                '车辆交互 <code>E</code> 优先解析车外可押送目标，避免车内已有嫌疑人时误触发下车。补齐 secondary follow / boarding 标记；移除「主目标回步行就强制副目标下车」的冲突逻辑，保留「玩家下车后嫌犯留车内，按 G 再一起下车」方案。',
                '逮捕序列收紧动画 anchor 安全半径、垂直落差校验、snap 距离上限与 cuff lock 单帧步进上限；异常 anchor 放弃 snap，降低相机入地后实体大距离瞬移风险。银行剧情警车不再反复 <code>Position = origin</code> 搬回 approach，必须实际接近 staging 才结算抵达；司机不在车内时优先 <code>TASK_ENTER_VEHICLE</code>，距离异常则跳过本次驾驶命令。',
                '<strong>嫌疑人生成稳定性</strong>',
                '当 ambient 模型池连续失败时，改用固定模型池兜底（business / mexgoon / freemode），根治「all fallbacks failed」导致接案无嫌、狂按 E/G 刷屏 <code>no current suspect</code> 的下游症状。外观不再完全随机 ambient，这是为稳定性做的有意取舍。',
                '警员档案 <code>SaveOfficerProfile()</code> 走原子写盘（临时文件 + <code>File.Replace</code>，最多 3 次重试）；失败时明确提示「保存失败」，不再误报「已保存」。',
                '<strong>UI：统一指挥台主题</strong>',
                '新增 <code>TactfrUiTheme.cs</code> 集中调色板与绘制原语，终结此前 5+ 份重复配色。警察终端重建为页眉 + accent 下划线 / 左列表 / 右简报 / 页脚布局，数据与输入逻辑零改动。',
                '第二批迁移全部常驻菜单到统一 <code>ListMenu</code> 渲染器：F7 调度、巡逻指令、后备箱装备、F8 小队、车库警服。修复 F7 调度菜单 13 项面板中心锚在 0.22、表头被顶出屏外的问题；键位提示统一 <code>GetKeyDisplayName</code> 友好显示。',
                '<strong>玩法扩展与架构债务</strong>',
                '警车后备箱装备菜单（<code>B</code> 键，执勤中距警务车 5m）：战术防弹衣 / 步枪 / 霰弹枪 / 急救包 / 雪糕筒 / 警笛点燃。拖车系统：调度菜单呼叫拖车，offscreen 生成 → 挂钩驶离 → 黄色 Blip 跟随，支持「解散拖车」。',
                '6 个 legacy 系统完成事件订阅治理（SpikeStrip / K9 / Convoy / SuspectController / SuspectOnFootExecutor / SuspectVehicleEscortExecutor）：缓存委托，<code>Initialize()</code> 订阅，<code>Shutdown()</code> 对称退订。',
                '<strong>AI：legacy 链路独立 Officer AI</strong>',
                '不改动 <code>EnableV6Runtime=false</code> 默认值。新增 <code>OfficerAILegacyHost</code>：在 legacy 主链独立启用 Officer AI，读取 <code>config.ini</code> 的 Provider / CloudAPIKey / LocalEndpoint；与 V6 GameLoop 互斥。想看到智能行为：填 DeepSeek Key 或启动 SentienceV5.2 启动器本地模型（默认端口 5001）；不想用 AI 设 <code>[AI] EnableOfficerAI=false</code>。',
                'DeepSeek 接入约束不变：LLM 输出必须为 JSON 白名单动作与短对白，游戏内只解析允许字段；中文显示走 GTA 原生 subtitle，避免 3D 文本缺字。嫌犯 LLM 原创台词目前仍只显示字幕，TTS 朗读对齐 SentienceV5.2 为后续批次。',
                '<strong>与 Beta.2 保留一致的核心</strong>',
                '故事任务框架与银行抢劫章节、七阶段逮捕 + 四组镜头 + 慢动作、警官小队连续双嫌逮捕、警察终端三区右栏、V6 PullOver / Patrol 纯切片、<code>LegacyTacticalContextBridge</code> 句柄镜像——这些 Beta.2 能力在 2.7 中完整保留并在此基础上加固。',
                '<strong>安装与配置</strong>',
                '将 <code>a.TACTFR.dll</code> 放入 GTA V <code>scripts/</code> 目录，配合 ScriptHookV + ScriptHookVDotNet。终端按 O 打开，选 920 进入银行警报剧情。本地 AI：在 SentienceV5.2 启动器点「启动本地模型」使 5001 有服务；或 <code>config.ini</code> 设 <code>Provider=cloud</code> 填 DeepSeek Key。',
                '日志确认：<code>[EFCore] EF Police Mod TACTFR-6.0.0-BETA-2.7 loaded</code>；legacy AI 路径见 <code>[Legacy:AI] Officer AI host initialized</code>。',
                '<strong>已知限制</strong>',
                'V6 运行时默认仍关闭，需单独 smoke test 后再考虑默认开启。拘捕上铐段同步场景与镜头避墙待在实机截图后迭代。Anima LLM 请求失败若本地 5001 未监听，属环境依赖而非代码缺陷。',
                'TACTFR 6.0.0 Beta.2.7 不是换皮预览，而是把 6.0 主链路上每一个「差一点」焊成「能玩一整局」——从假投降反杀到双嫌上车，从交付语义到统一指挥台 UI。',
                '—— TACTFR 开发团队'
            ]
        },
        en: {
            title: 'Introducing TACTFR 6.0.0 Beta.2.7 Preview',
            date: 'June 8, 2026',
            category: 'Product',
            readTime: '14 min read',
            paragraphs: [
                'Abstract: Today we ship **TACTFR 6.0.0 Beta.2.7** — building on Beta.2 story missions and the seven-stage arrest pipeline, this release hardens suspect behavior, delivery semantics, dual-target escort, unified UI theming, and legacy-path Officer AI into a playable state. Version <code>6.0.2.7</code> (<code>TACTFR-6.0.0-BETA-2.7</code>), Release|x64 clean build. QQ group 1061632354.',
                '<strong>From Beta.2 to Beta.2.7</strong>',
                'Beta.2 laid the 6.0 skeleton: layered story missions (full bank heist arc), cinematic seven-stage arrests, officer-squad consecutive dual-suspect cuffs, terminal redesign, and pure-V6 PullOver / Patrol slices. Beta.2.7 stops expanding architecture and welds every player-visible fracture — suspects failing to spawn, dual boarding desync, false “successful delivery”, arrest camera clipping underground, bank police teleporting, and menus each with their own color palette.',
                '<strong>Suspect behavior: GTA6 moments</strong>',
                'Armed suspects under aim pressure can enter a <strong>fake surrender chain</strong>: hands up ~1.8s → turn-and-draw ~0.7s tell window → weapon resist via standard <code>ForceResist</code>. When not aimed at, ~1.2s scans for active police: civilians/nervous types flee and plead; violent types turn and back off; armed maniacs may counter-attack when officers close with guns drawn.',
                'Scans <strong>exclude the player\'s own cruiser</strong> — parking your police car nearby won\'t spook suspects. All verified in-engine natives with lip-sync ambient speech, no LLM server required.',
                'New <strong>X-key suspect voice interaction</strong> (<code>SuspectVoiceInteract</code>, rebindable in TACTFR.ini): cycles command shout → insult → comfort → chat. Player officer shouts with <code>FORCE_SHOUTED</code>; suspects respond with facial anim and built-in voice lines matched to tone and personality.',
                '<strong>Delivery and case closure semantics</strong>',
                'Fixed <code>CaseManager.OnSuspectDelivered()</code> falsely completing cases on exceptions. <code>MarkDelivered()</code> now returns real success. Dual-suspect rule A: <strong>any death or escape blocks the full “successful delivery” message</strong>, settling as <code>SuspectDead</code> or <code>Failed</code>. <code>DeliverSystem</code> caches delegates with symmetric unsubscribe on shutdown.',
                '<strong>Dual-target escort and arrest camera</strong>',
                'Vehicle <code>E</code> interaction prioritizes outside escortable targets. Secondary follow/boarding markers fixed; removed logic that kicked the secondary out when the primary returned to on-foot. Arrest sequence tightens anchor safety, vertical delta checks, snap distance caps; bank phase police no longer teleport-staging — must actually approach before arrival counts.',
                '<strong>Suspect spawn stability</strong>',
                'Fixed model pool fallback when ambient selection fails, ending “all fallbacks failed” and downstream <code>no current suspect</code> spam. Officer profile saves atomically with honest failure messaging.',
                '<strong>UI: unified command-console theme</strong>',
                '<code>TactfrUiTheme.cs</code> centralizes palette and draw primitives. Terminal rebuilt; F7 dispatch, patrol, trunk, F8 squad, and uniform menus migrated to shared <code>ListMenu</code> renderer with friendly key names.',
                '<strong>Gameplay and architecture debt</strong>',
                'Trunk equipment menu (<code>B</code> near police vehicle): armor, rifles, shotgun, medkit, cones, siren flare. Tow truck via dispatch menu with dismiss option and yellow blip. Six legacy systems received event-subscription governance with symmetric shutdown.',
                '<strong>AI: legacy Officer AI host</strong>',
                '<code>OfficerAILegacyHost</code> enables Officer AI on the legacy path without flipping <code>EnableV6Runtime</code> default. Configure DeepSeek or local port 5001 via <code>config.ini</code>; disable with <code>EnableOfficerAI=false</code>. LLM output remains JSON-whitelisted; TTS for custom lines aligns with SentienceV5.2 in a later batch.',
                '<strong>Carried forward from Beta.2</strong>',
                'Story framework, bank chapter, seven-stage arrest + four camera rigs, squad dual-suspect chain, terminal three-zone panel, V6 PullOver/Patrol slices, and <code>LegacyTacticalContextBridge</code> handle mirroring — all retained and reinforced.',
                '<strong>Install</strong>',
                'Drop <code>a.TACTFR.dll</code> into <code>scripts/</code>. Terminal O → option 920 for bank alarm. Start local model on port 5001 or set cloud DeepSeek in <code>config.ini</code>.',
                'TACTFR 6.0.0 Beta.2.7 welds every “almost there” moment on the 6.0 main path into something you can play start to finish.',
                '— TACTFR Development Team'
            ]
        }
    },
    sentienceV4ob: {
        overlay: 'Sentience V4.1 Omni',
        media: { type: 'video', src: 'Logo/意识V4o.webm', poster: 'Logo/4.1Omni.png', fit: 'cover', alt: 'Sentience V4 Omni' },
        zh: {
            title: '隆重介绍 SentienceV4.1 Omni 正式版',
            date: '2026年4月28日',
            category: '产品',
            readTime: '12 分钟阅读',
            paragraphs: [
                '今天，我们隆重推出 **SentienceV4.1 Omni 正式版**——GTA V 沉浸式 AI NPC 交互体验的全新里程碑。',
                '从 Beta 到正式版，我们不仅仅是在修复 bug，而是在重新定义玩家与虚拟世界的互动方式。SentienceV4.1 Omni 代表着更稳定的性能、更丰富的自定义选项，以及更开放的生态。',
                '核心亮点',
                '🚀 全新 NexusVLauncher',
                '我们对启动器 UI 进行了全面升级，带来更直观、更流畅的配置体验：',
                '全新界面设计 — 更清晰的导航，更简洁的操作流程',
                '多服务商 API 支持 — 原生支持 DeepSeek、OpenAI 等主流 API，已更新至最新 model 接口',
                '深度自定义配置 — 自定义端口、线程数、上下文长度，满足各种性能需求',
                '一键部署 — 解压 → 启动 → 游戏，三步搞定',
                '⚡ 性能全面优化',
                '基于最新脚本钩子构建，适配 GTA V 最新版本：',
                '游戏内性能提升 — 更低的延迟，更流畅的对话体验',
                '内存占用优化 — 更高效的资源管理',
                '推理加速 — 本地模型推理速度提升 20%',
                '🔧 开放与兼容',
                'SentienceV4.1 继续保持开放生态：',
                '✅ GTA V Legacy 版与 Enhanced 版双支持',
                '✅ 本地推理（llama.cpp）与云端 API 无缝切换',
                '✅ OpenAI 兼容接口',
                '✅ 多种 TTS / STT 方案支持',
                '下载与体验',
                '🌟 NexusV 官网: https://nexusvai.github.io/NexusV/',
                '🎮 玩家动力传承版: https://www.wanjiadongli.com/mods/296810',
                '🚀 玩家动力增强版: https://www.wanjiadongli.com/mods/295861',
                '🎲 3DM: https://mod.3dmgame.com/mod/253070',
                '📦 百度网盘: https://pan.baidu.com/s/1MW6xYIueFIG7s3bjhSKLKg?pwd=Nexu',
                '注意：部分平台可能存在同步延迟，请耐心等待最新版本上架。',
                '五一特别活动 🎉',
                '玩家动力社区五一全新活动火热进行中！',
                '白嫖 Steam 游戏',
                'VIP 会员免费送',
                '绝对真实！加群 1075957856 了解详情。',
                '技术规格',
                '最低配置: GT730 + i5-10400',
                '推荐配置: GTX 1060 6GB + i5-10400 及以上',
                '本地模型: Qwen3.5 2B 专属微调版',
                'API 支持: DeepSeek、OpenAI、自定义兼容接口',
                '游戏版本: GTA V Legacy / Enhanced',
                '开发者信息',
                'Sentience 源代码遵循 MIT 许可证开源：',
                'GitHub: https://github.com/NexusVAI/SENTIENCE',
                '加入我们的开发社区，共同打造更智能的游戏 NPC 生态。',
                '支持与反馈',
                '模组反馈2群: 1061632354',
                '玩家动力活动群: 1075957856',
                '详细教程请下载模组后查看文档与视频。',
                'SentienceV4.1 Omni — 让洛圣都的每一个 NPC，都拥有真正的数字灵魂。',
                '让游戏世界，真正开始"回应"你。'
            ]
        },
        en: {
            title: 'Introducing SentienceV4.1 Omni Official Release',
            date: 'April 28, 2026',
            category: 'Product',
            readTime: '12 min read',
            paragraphs: [
                'Today, we proudly present **SentienceV4.1 Omni Official Release**—a new milestone in immersive AI NPC interaction for GTA V.',
                'From Beta to Official Release, we are not just fixing bugs, but redefining how players interact with the virtual world. SentienceV4.1 Omni represents more stable performance, richer customization options, and a more open ecosystem.',
                'Key Highlights',
                '🚀 All-New NexusVLauncher',
                'We have completely upgraded the launcher UI for a more intuitive and smoother configuration experience:',
                'New Interface Design — Clearer navigation, simpler workflow',
                'Multi-Provider API Support — Native support for DeepSeek, OpenAI and other mainstream APIs, updated to the latest model interface',
                'Deep Customization — Customize ports, thread counts, context length to meet various performance needs',
                'One-Click Deployment — Extract → Launch → Game, done in three steps',
                '⚡ Comprehensive Performance Optimization',
                'Built on the latest script hooks, adapted for the latest GTA V version:',
                'In-Game Performance Boost — Lower latency, smoother dialogue experience',
                'Memory Usage Optimization — More efficient resource management',
                'Inference Acceleration — Local model inference speed increased by 20%',
                '🔧 Open and Compatible',
                'SentienceV4.1 continues to maintain an open ecosystem:',
                '✅ Dual support for GTA V Legacy and Enhanced versions',
                '✅ Seamless switching between local inference (llama.cpp) and cloud APIs',
                '✅ OpenAI compatible interface',
                '✅ Support for multiple TTS / STT solutions',
                'Download and Experience',
                '🌟 NexusV Official Site: https://nexusvai.github.io/NexusV/',
                '🎮 Player Power Legacy: https://www.wanjiadongli.com/mods/296810',
                '🚀 Player Power Enhanced: https://www.wanjiadongli.com/mods/295861',
                '🎲 3DM: https://mod.3dmgame.com/mod/253070',
                '📦 Baidu Cloud: https://pan.baidu.com/s/1MW6xYIueFIG7s3bjhSKLKg?pwd=Nexu',
                'Note: Some platforms may have sync delays, please wait patiently for the latest version to be listed.',
                'May Day Special Event 🎉',
                'Player Power Community May Day New Event is now live!',
                'Free Steam Games',
                'Free VIP Memberships',
                'Absolutely real! Join group 1075957856 for details.',
                'Technical Specifications',
                'Minimum Config: GT730 + i5-10400',
                'Recommended Config: GTX 1060 6GB + i5-10400 and above',
                'Local Model: Qwen3.5 2B Exclusive Fine-tuned Version',
                'API Support: DeepSeek, OpenAI, Custom Compatible Interfaces',
                'Game Version: GTA V Legacy / Enhanced',
                'Developer Information',
                'Sentience source code is open source under MIT license:',
                'GitHub: https://github.com/NexusVAI/SENTIENCE',
                'Join our development community to build a smarter game NPC ecosystem together.',
                'Support and Feedback',
                'Mod Feedback Group 2: 1061632354',
                'Player Power Event Group: 1075957856',
                'For detailed tutorials, please check the documentation and videos after downloading the mod.',
                'SentienceV4.1 Omni brings a new level of immersion to GTA V by giving every NPC a true digital soul.',
                'Experience a game world that truly responds to your actions.'
            ]
        }
    },
    sentienceV52mens: {
        overlay: 'Sentience V5.2 Mens',
        media: { type: 'video', src: 'Logo/NewImage-0608.mp4', poster: 'Logo/neyyys.png', fit: 'cover', alt: 'Sentience V5.2 Mens' },
        zh: {
            title: '隆重介绍 SentienceV5.2 Mens 正式版',
            date: '2026年6月8日',
            category: '产品',
            readTime: '18 分钟阅读',
            paragraphs: [
                '摘要：今天我们发布 **SentienceV5.2 Mens 正式版**——GTA V 沉浸式 AI NPC 模组的下一代架构。V5.2 在 V4.1 Omni 的对话引擎之上，引入了完整的认知栈：五层记忆、五轴人格向量、十二意图效用评分、目击传播与三跳流言网络。模组遵循 MIT 许可证完全开源，SDK 1.0 插件无需重编译即可加载，并为开发者预留了意图注册、场景 JSON、插件 ABI 等扩展接口。',
                '<strong>从 Omni 到 Mens：两代架构的分野</strong>',
                'SentienceV4.1 Omni 正式版解决的是"能不能稳定对话"——多服务商 API、本地与云端 LLM 切换、TTS/STT 管线、启动器体验、OpenAI 兼容接口。它是一个成熟的对话层产品，让洛圣都的 NPC 能够听懂你说的话、用合适的声音回答你。',
                'SentienceV5.2 Mens 解决的是"NPC 是否像一个有记忆、有性格、有社会关系的个体"——这是次世代 Mod 的核心命题。V5.2 在 V5.1 Animus 插件 SDK 与 V5/V5.1 对话管线之上叠加了三层全新子系统（认知 Cognition、记忆 Memory、社会/具身 Social/Embodiment），与既有存档和插件完全向后兼容。',
                '<strong>架构：Mens 认知栈</strong>',
                'V5.2 的数据流从玩家输入开始，经 AIManager 路由至本地 llama.cpp 或云端 LLM（DeepSeek / Qwen / GPT-4 / Claude），再由 PromptBuilder 自动在 PIPE 格式（V5.1 兼容，适用于小参数本地模型）与 INTENT_JSON 格式（云端推荐，要求模型返回结构化意图）之间切换。',
                'LLM 输出进入 Cognition 层：IntentResolver 在 12 个内置意图（GreetFriendly、WarnOff、BackAway、FleeInPanic、CallCops、Salute、Mock、Threaten、Comply、Recoil、Speak、Idle）之间做效用评分，UtilityScorer 读取实时漂移的 PersonalityVector 决定身体语言——同一句台词，五种人格向量会走出五种不同的肢体反应。',
                'Memory 层维护五个并行存储：WorkingMemory（30 秒对话窗口，纯 RAM）、EpisodicMemory（每 NPC 50 条事件，JSON 持久化）、GossipMemory（每 NPC 30 条流言，三跳可信度衰减）、AreaMemory（区域危险热力图，约 60 分钟半衰期）、SemanticMemory（玩家标签派生，如"暴力分子"/"友好"）。',
                'Social 层让 NPC 不再孤立：WitnessRegistry 在 40–50 米半径内将玩家行为扇出为目击事件；RelationshipGraph 基于 5 米 × 3 秒停留建立 NPC 邻接边；GossipTick 以 2 秒节拍沿关系图传播流言，最远三跳。',
                'Embodiment 层负责"身体在场"：FacialExpressionManager 驱动 PLAY_FACIAL_ANIM 五种情绪映射（3 秒冷却）；AmbientBehavior 在 NPC 生成时分配环境场景（抽烟、倚靠、打电话），且 AI 对话不会粗暴打断这些场景——默认仅头部瞥视，只有 GreetFriendly / Salute / Speak 意图才旋转身体面向玩家。',
                '<strong>与 V4.1 的关键差异一览</strong>',
                'V4.1 Omni 的核心是"对话管道 + 启动器 + 多服务商接入"，NPC 人格是相对静态的字符串标签，记忆限于 legacy NPCMemory 单表，没有跨 NPC 的社会传播，也没有意图驱动的身体语言选择。',
                'V5.2 Mens 在此基础上新增了：五轴人格向量（aggression / openness / anxiety / sociability / integrity）及每次交互的漂移规则；云端 LLM 的 JSON 意图协议与 4 条 few-shot 示例；多并发云端请求（默认 cloud=8、local=2，硬顶 32）；小米 MiMo 云端 TTS（9 种内置中文音色，情绪标签自动前缀，失败自动回退 edge-tts）；游戏内 F5 → 心智 Mens 子菜单，实时查看最近 NPC 的人格向量、五层记忆计数与社会图统计。',
                '向后兼容性经过验证：V5.1 存档的 npc_memory.json 原样加载；SDK 1.0 插件（如 Sentience.Plugins.PoliceRP）零重编译运行；本地 3B 模型仍走 V5.1 PIPE prompt，无需升级硬件即可游玩。',
                '<strong>开发者接口与开源生态</strong>',
                'Sentience 模组遵循 MIT 许可证，完整源码镜像随发布包提供。开发者可以：',
                '通过 ISentiencePlugin SDK 1.0 编写插件，注册自定义 NPC 原型、场景与意图扩展点；',
                '参考 samples/Sentience.Plugins.PoliceRP 示例工程与 docs/Plugin-Development-Guide.md 快速上手；',
                '使用 Scenario JSON（hostile_biker.json、traffic_stop.json 等）定义可复用的交互剧本；',
                'Fork launcher 源码（Flet + PyInstaller）自定义 TTS/LLM 配置 UI；',
                '直接阅读 Memory/、Cognition/、Social/、Embodiment/ 目录下的 C# 源码，理解 Mens 管线的每一个决策点。',
                'SDK 1.1（计划随 V5.3 发布）将新增可选的 INPCMemoryView 与 IIntentRegistry 接口，让插件能够读取并扩展 Mens 认知状态——V5.2 已为这一演进预留了注册表与 partial class 扩展点。',
                '<strong>配置与部署</strong>',
                '最低配置：GT730 + i5-10400。推荐配置：GTX 1060 6GB + i5-10400 及以上。本地模型为 gta5_npc_v2_q4_K_M GGUF（1.2 GB），由 bundled llama.cpp 在 8080 端口服务。',
                '配置文件位于 <code>%USERPROFILE%/Documents/GTA5MOD2026/config.ini</code>，完整注释模板见 config.reference.ini。云端 LLM 推荐配置：',
                '<code>[LLM] Provider = cloud / CloudProvider = deepseek / CloudModel = deepseek-chat</code>',
                '云端 TTS：启动器 → 语音卡片 → 云端按钮 → 填入小米 MiMo API Key → 测试 → 保存。热重载，无需重启 TTS 服务。',
                '安装步骤：ScriptHookV + ScriptHookVDotNet 3 → 将 ModFiles/ 复制到 GTA V scripts 目录 → 运行 SentienceV5.exe → 启动 TTS → 启动本地模型或配置云端 → 进游戏按 G 对话。',
                '<strong>游戏内操作</strong>',
                'G — 与最近 NPC 对话；H — 跳过当前 TTS；T — 切换头顶标签；J — 循环响应显示模式；F5 — 打开 Sentience 菜单（含心智 Mens 查看器、插件管理、模组设置）。',
                '<strong>验证与质量</strong>',
                'V5.2.0 发布前完成：dotnet build 模组工程 0 error；示例插件 0 error 0 warning；SDK 1.0 ABI 100% 兼容；Python voice_server.py / launcher 全量 py_compile 通过；认知管线从云端 JSON → intent → UtilityScorer → 动作全链路 trace 验证。',
                'docs/Mens-Cases.md 收录了 11 个可直接录制的演示场景，涵盖目击、流言、区域记忆、人格漂移与表情驱动等玩家可感知能力。',
                '<strong>下载</strong>',
                'NexusV 官网：https://nexusvai.github.io/NexusV/',
                'GitHub 源码：https://github.com/NexusVAI/SENTIENCE',
                '模组反馈群：1061632354',
                'SentienceV5.2 Mens 不是对 V4.1 的修补，而是 GTA V AI NPC 领域的下一代 Mod 架构——它让洛圣都的每一个路人，都拥有记住你、议论你、因你而改变人格的权利。',
                '—— NexusV 团队'
            ]
        },
        en: {
            title: 'Introducing SentienceV5.2 Mens Official Release',
            date: 'June 8, 2026',
            category: 'Product',
            readTime: '18 min read',
            paragraphs: [
                'Abstract: Today we release **SentienceV5.2 Mens Official** — the next-generation architecture for immersive AI NPC mods in GTA V. V5.2 layers a full cognitive stack on top of the V4.1 Omni dialogue engine: five-layer memory, five-axis personality vectors, twelve-intent utility scoring, witness propagation, and a three-hop gossip network. The mod is fully open source under MIT, SDK 1.0 plugins load without recompilation, and developers get extension points for intent registration, scenario JSON, and the plugin ABI.',
                '<strong>From Omni to Mens: two generations</strong>',
                'SentienceV4.1 Omni solved "can we talk stably" — multi-provider APIs, local/cloud LLM switching, TTS/STT pipelines, launcher UX, OpenAI-compatible endpoints. It is a mature dialogue product that lets Los Santos NPCs hear you and answer with the right voice.',
                'SentienceV5.2 Mens solves "does this NPC feel like someone with memory, personality, and social ties" — the defining question of a next-gen mod. V5.2 stacks three new subsystems (Cognition, Memory, Social/Embodiment) on the V5.1 Animus plugin SDK and legacy dialogue pipeline, fully backward-compatible with existing saves and plugins.',
                '<strong>Architecture: the Mens cognitive stack</strong>',
                'Player input flows through AIManager to local llama.cpp or cloud LLMs (DeepSeek / Qwen / GPT-4 / Claude). PromptBuilder auto-switches between PIPE format (V5.1 compat, small local models) and INTENT_JSON (cloud-recommended, structured intent output).',
                'Cognition: IntentResolver scores across 12 built-in intents; UtilityScorer reads the live drifting PersonalityVector to pick body language — the same line of dialogue yields five different physical reactions across five personality profiles.',
                'Memory: WorkingMemory (30s window), EpisodicMemory (50 events/NPC), GossipMemory (30 entries, 3-hop credibility decay), AreaMemory (zone danger heatmap, ~60min half-life), SemanticMemory (derived player tags).',
                'Social: WitnessRegistry fans player actions to nearby NPCs (40–50m); RelationshipGraph builds proximity edges (5m × 3s dwell); GossipTick propagates rumours at 2s cadence, up to three hops.',
                'Embodiment: FacialExpressionManager drives PLAY_FACIAL_ANIM with five mood mappings; AmbientBehavior assigns spawn scenarios (smoking, leaning, on-phone) that dialogue does not brutally interrupt — head glance by default, body turn only for GreetFriendly / Salute / Speak.',
                '<strong>Key deltas from V4.1</strong>',
                'V4.1 Omni centered on dialogue pipes + launcher + multi-provider access. NPC personality was a relatively static string label; memory was limited to legacy NPCMemory; no cross-NPC social propagation; no intent-driven body language.',
                'V5.2 Mens adds: five-axis personality vectors with per-interaction drift; cloud LLM JSON intent protocol with few-shot examples; multi-concurrent cloud requests (default cloud=8, local=2, hard cap 32); Xiaomi MiMo cloud TTS (9 Chinese voices, emotion tags, edge-tts fallback); in-game F5 → Mens viewer for live vectors, memory counts, and social graph stats.',
                'Backward compatibility verified: V5.1 npc_memory.json loads unchanged; SDK 1.0 plugins (e.g. Sentience.Plugins.PoliceRP) run without recompile; local 3B models still use V5.1 PIPE prompts.',
                '<strong>Developer APIs and open source</strong>',
                'Sentience is MIT-licensed with a full source mirror in every release. Developers can: write plugins via ISentiencePlugin SDK 1.0; reference the PoliceRP sample and Plugin-Development-Guide.md; author Scenario JSON; fork the Flet launcher; read Memory/, Cognition/, Social/, Embodiment/ C# sources directly.',
                'SDK 1.1 (planned for V5.3) will add optional INPCMemoryView and IIntentRegistry surfaces — V5.2 already reserves registry and partial-class extension points for this evolution.',
                '<strong>Setup</strong>',
                'Min: GT730 + i5-10400. Recommended: GTX 1060 6GB + i5-10400+. Local model: gta5_npc_v2_q4_K_M GGUF (1.2 GB) served by bundled llama.cpp on port 8080.',
                'Config at <code>%USERPROFILE%/Documents/GTA5MOD2026/config.ini</code>. Cloud LLM: <code>Provider = cloud</code>, <code>CloudProvider = deepseek</code>. MiMo TTS via launcher cloud button with hot-reload.',
                'Install: ScriptHookV + SHVDN3 → copy ModFiles/ to scripts → run SentienceV5.exe → start TTS → start local model or configure cloud → press G in-game.',
                '<strong>In-game controls</strong>',
                'G — talk to nearest NPC; H — skip TTS; T — toggle labels; J — cycle display mode; F5 — Sentience menu with Mens viewer.',
                '<strong>Verification</strong>',
                'Pre-release: dotnet build 0 errors; sample plugin 0 warnings; SDK 1.0 ABI 100% compatible; full Python py_compile clean; cognition pipeline end-to-end traced. docs/Mens-Cases.md ships 11 record-ready demo scenarios.',
                '<strong>Download</strong>',
                'NexusV: https://nexusvai.github.io/NexusV/ | GitHub: https://github.com/NexusVAI/SENTIENCE | Feedback: 1061632354',
                'SentienceV5.2 Mens is not a patch on V4.1 — it is the next-generation mod architecture for GTA V AI NPCs. Every passerby in Los Santos now has the dignity of remembering you, gossiping about you, and changing who they are because of you.',
                '— The NexusV Team'
            ]
        }
    },
    cancriCode: {
        overlay: 'Cancri Code',
        media: { type: 'image', src: 'Logo/15933dbaacdc5cfed5b7f9fc0f14cf96.png', alt: 'Cancri Code' },
        zh: {
            title: '介绍你的 AI 助理 Cancri Code',
            date: '2026年6月8日',
            category: '产品',
            readTime: '14 分钟阅读',
            paragraphs: [
                '摘要：今天我们正式介绍 **Cancri Code**——NexusV 团队打造的本地 AI 编程助理。它是一款基于 Tauri 2 的桌面 IDE，采用组装主义架构（Monaco Editor、xterm.js、tree-sitter、ripgrep 等独立开源组件），通过 Agentic Tool-Calling 范式让 AI 能够自主读取、编辑、搜索和执行你的代码库。Cancri Code 接入 NexusV 自研 chat-gateway，在统一账户体系下使用 40+ 顶尖大语言模型，当前版本 v1.5.0。',
                '<strong>为什么需要 Cancri Code</strong>',
                '通用 AI 聊天窗口擅长回答孤立的问题，但在真实工程场景中，开发者需要的是：理解整个仓库上下文、跨文件重构、先搜索再修改、运行命令验证结果。Cancri Code 的定位不是"另一个聊天框"，而是坐在你项目旁边的 AI 结对程序员——它打开你的文件夹，看见你的文件树，在 Monaco 编辑器里与你共读同一份代码。',
                '与 Fork 整个 VS Code 不同，Cancri Code 走组装主义路线：每个零件从开源世界独立选取，UI、快捷键、插件系统与品牌 100% 自主。这意味着我们不被 upstream 绑架，却能复用经过验证的编辑器内核与终端组件。',
                '<strong>核心能力</strong>',
                '<strong>Agentic 工具循环</strong>：Cancri Code 采用 vNext 架构，LLM 通过原生 tool_calls 调用 read_file、edit_file、write_file、glob、grep、bash 等工具。Agent Loop 自动执行工具、回填结果、继续推理，直到任务完成。写类工具走用户审批闸门（沿用成熟的 Apply 卡片体验），读类工具默认放行。',
                '<strong>SEARCH/REPLACE 编辑协议</strong>：edit_file 工具包装了经过生产验证的四级模糊匹配算法（精确匹配 → 缩进容错 → trim-line → Levenshtein 提示），在 AI 建议与磁盘落盘之间保留了人工确认环节，避免误改。',
                '<strong>多文件上下文</strong>：用户可以用 @file: 协议显式引用文件，也可以直接输入文件名由 IDE 自动探针注入。拖入文件、粘贴图片、引用工作区路径——composer 支持多模态输入与 .cancri-drops 临时目录管理。',
                '<strong>模型与网关</strong>：桌面端通过真实用户 JWT 接入 NexusV chat-gateway，可使用 DeepSeek、Claude、GPT、Qwen、GLM、Kimi 等 40+ 模型。Provider 抽象层支持 OpenAI-compatible、Anthropic Messages 与 Tauri Bridge 三种路径，模型选择与运行模式（本地/云端）持久化到本地设置。',
                '<strong>IDE 工作区</strong>：欢迎页 → 打开文件夹 → 进入三栏工作区（文件树 / Monaco 编辑器 / 资源面板）。内置 xterm.js 终端、PTY 支持、自定义标题栏、侧栏与资源面板可折叠并 localStorage 持久化。支持最近项目列表、工作区自动重开、Codex 风格启动流光。',
                '<strong>会话与轨迹</strong>：对话历史按项目归档，支持置顶、重命名、自动标题生成。Session Trajectory 记录 Agent 每一步工具调用，为未来的 revert/fork/replay 奠定基础。切换对话时后台 Agent 可继续运行，切回时重连实时渲染——多会话不再互相抢占。',
                '<strong>扩展生态</strong>：Rules 系统让项目级 AI 行为可配置；Skills 商店支持自定义技能注入；MCP 插件协议可挂载外部工具服务器；Subagent 支持派生子任务并行探索。Trajectory 上传（需用户明示同意）帮助改进模型在真实工程场景中的表现。',
                '<strong>安全设计</strong>',
                'Markdown 链接经过 scheme 白名单过滤（阻断 javascript:/data:/ipc: 等注入向量）。客户端内置速率限制（并发 1、每分钟 10 次、每天 20 次）作为后端配额_gate 的第一道门。CSP 与 XSS 防护在 v0.15.x 安全审查中系统加固。桌面端通过 Supabase OAuth 登录，不再依赖硬编码 secret。',
                '<strong>技术栈</strong>',
                '前端：TypeScript + Vite 6 + Monaco Editor 0.55。桌面壳：Tauri 2（Rust 后端提供文件 IO、PTY、HTTP SSE 流、Agent 工具执行）。测试：Vitest 129+ 用例，cargo test 覆盖 Rust agent_tools 模块。构建：pnpm tauri build 产出 Windows 安装包与便携 exe。',
                'Rust 端 agent_tools 模块提供 glob、grep、bash、文件读写等 IPC 命令；portable-pty 驱动集成终端；auth 模块处理 OAuth localhost 回调。前端 agent/ 目录包含 Provider 抽象、Tool Registry、Permission 策略与 Agent Loop 核心循环。',
                '<strong>与 NexusV 生态的关系</strong>',
                'Cancri Code 与 ChatAI 共享 NexusV 账户与 chat-gateway 基础设施，但产品定位不同：ChatAI 是面向所有用户的 Web 对话平台，Cancri Code 是面向开发者的本地 IDE。它与 Sentience/TACTFR 游戏模组无功能耦合，却共享同一支工程团队对"AI 应该理解上下文、应该能动手、应该对用户透明"的产品哲学。',
                '<strong>现状与路线图</strong>',
                '当前 v1.5.0 已具备：完整 IDE 工作区、Agentic 工具循环、多模型网关、会话归档、Rules/Skills/MCP、后台运行、Windows 桌面打包。后续重点：完善 bash 工具白名单与权限分级、Trajectory replay UI、Android 端远程壳、以及 SDK 化开放给第三方自动化流水线。',
                'Cancri Code 是我们对"AI 编程助理应该长什么样"的回答——不是云端黑盒，不是 Fork 绑架，而是一个能打开你项目、读懂你代码、在你确认后动手修改的本地搭档。',
                '—— NexusV 工程团队'
            ]
        },
        en: {
            title: 'Meet Your AI Assistant — Cancri Code',
            date: 'June 8, 2026',
            category: 'Product',
            readTime: '14 min read',
            paragraphs: [
                'Abstract: Today we introduce **Cancri Code** — NexusV\'s local AI programming assistant. Built on Tauri 2 with an assembly-architecture IDE (Monaco Editor, xterm.js, tree-sitter, ripgrep as independent open-source parts), it uses an Agentic Tool-Calling paradigm so AI can autonomously read, edit, search, and execute across your codebase. Cancri Code connects to the NexusV chat-gateway under a unified account, giving access to 40+ top-tier LLMs. Current version: v1.5.0.',
                '<strong>Why Cancri Code</strong>',
                'Generic AI chat excels at isolated questions, but real engineering needs whole-repo context, cross-file refactors, search-then-edit workflows, and command execution to verify results. Cancri Code is not "another chat box" — it is an AI pair programmer sitting beside your project: it opens your folder, sees your file tree, and reads the same code as you in Monaco.',
                'Unlike forking VS Code, Cancri Code assembles independent open-source parts. UI, shortcuts, plugin system, and brand are 100% ours — no upstream lock-in, with battle-tested editor and terminal cores.',
                '<strong>Core capabilities</strong>',
                '<strong>Agentic tool loop</strong>: LLMs call read_file, edit_file, write_file, glob, grep, bash via native tool_calls. The agent loop executes tools, feeds results back, and continues until done. Write tools require user approval (Apply cards); read tools pass by default.',
                '<strong>SEARCH/REPLACE editing</strong>: edit_file wraps a production-grade four-level fuzzy matcher (exact → indent-tolerant → trim-line → Levenshtein hints), keeping human confirmation between AI suggestions and disk writes.',
                '<strong>Multi-file context</strong>: @file: protocol, bare-filename auto-detection, drag-and-drop, image paste, and .cancri-drops temp management in the composer.',
                '<strong>Models and gateway</strong>: Desktop authenticates with real user JWT to the NexusV chat-gateway — DeepSeek, Claude, GPT, Qwen, GLM, Kimi, and 40+ more. Provider abstraction covers OpenAI-compatible, Anthropic Messages, and Tauri Bridge paths.',
                '<strong>IDE workspace</strong>: Welcome → open folder → three-pane workspace (file tree / Monaco / resource panel). Built-in xterm.js terminal, PTY, custom titlebar, collapsible sidebars with localStorage persistence, recent projects, Codex-style boot shimmer.',
                '<strong>Sessions and trajectory</strong>: Per-project chat archives with pin, rename, auto-titles. Session Trajectory logs every agent tool step for future revert/fork/replay. Background agents keep running when you switch conversations.',
                '<strong>Extensions</strong>: Project-level Rules; Skills store; MCP plugin protocol; Subagent spawning; opt-in Trajectory upload for real-world engineering improvement.',
                '<strong>Security</strong>',
                'Markdown links sanitized via scheme whitelist. Client-side rate limits (concurrency 1, 10/min, 20/day) as first gate before backend quotas. XSS/CSP hardened in v0.15 security review. Desktop OAuth via Supabase — no hardcoded secrets.',
                '<strong>Stack</strong>',
                'Frontend: TypeScript + Vite 6 + Monaco 0.55. Shell: Tauri 2 (Rust file IO, PTY, HTTP SSE, agent tool execution). Tests: Vitest 129+, cargo test for agent_tools. Build: pnpm tauri build → Windows installer + portable exe.',
                '<strong>NexusV ecosystem</strong>',
                'Cancri Code shares accounts and chat-gateway with ChatAI but targets developers locally. It has no functional coupling to Sentience/TACTFR game mods, yet shares the team philosophy: AI should understand context, take action, and stay transparent.',
                '<strong>Roadmap</strong>',
                'v1.5.0 ships: full IDE workspace, agentic loop, multi-model gateway, session archives, Rules/Skills/MCP, background runs, Windows packaging. Next: bash whitelist, trajectory replay UI, Android remote shell, SDK for automation pipelines.',
                'Cancri Code is our answer to what an AI programming assistant should be — not a cloud black box, not a fork hostage, but a local partner that opens your project, reads your code, and edits with your approval.',
                '— NexusV Engineering Team'
            ]
        }
    },
    n4: {
        overlay: 'TACTFR',
        media: { type: 'image', src: 'Logo/L2.webp', alt: 'TACTFR V4' },
        zh: {
            title: 'TACTFR V4：执法闭环系统',
            date: '2026 年 3 月 03 日',
            category: '文档',
            readTime: '8 分钟阅读',
            paragraphs: [
                'Tactical First Response',
                '面向开放世界执法模拟的战术响应系统',
                '摘要（Abstract）',
                '我们介绍 TACTFR（Tactical First Response） —— 一个面向 Grand Theft Auto V 的国产独立警察模组框架，旨在将开放世界中的执法玩法转变为一个 结构化、稳定且可扩展的战术响应系统。',
                'TACTFR 的设计目标并不是简单地增加警察任务，而是构建一个完整的 执法行为闭环（Law Enforcement Gameplay Loop），让玩家能够在虚拟城市中体验从 值班、接警、处置案件到任务结束的完整执法流程。',
                '在 TACTFR V5 中，我们对整个系统进行了 架构级重构（Architectural Rewrite），引入模块化结构与状态机驱动逻辑，使系统从早期脚本逻辑转变为 可持续扩展的战术执法框架。',
                '截至目前，TACTFR 已发展至 5.4.0 版本，并持续扩展新的案件类型与战术功能。',
                '项目背景',
                '开放世界游戏通常拥有丰富的城市环境，但执法系统往往依赖脚本化任务，缺乏持续运行的结构化逻辑。',
                'TACTFR 的核心目标是解决三个问题：',
                '1. 执法流程碎片化',
                '大多数警察模组只提供单次任务，而缺乏完整执法流程。',
                '2. 系统稳定性不足',
                '复杂脚本逻辑容易导致任务无法结束或状态不同步。',
                '3. 扩展能力有限',
                '旧架构难以支持新的案件类型或战术机制。',
                'TACTFR 尝试通过 统一的任务系统与战术框架 来解决这些问题。',
                'V4：执法闭环系统',
                'TACTFR V4 是一个 独立警察模组，无需复杂依赖即可运行。',
                '虽然功能并非最复杂，但其核心优势在于：',
                '稳定与完整的执法流程。',
                'V4 的核心玩法围绕 执法闭环（Law Enforcement Loop） 展开：',
                '玩家上班执勤',
                '接收警情任务',
                '前往现场处理案件',
                '完成执法流程',
                '任务结束并恢复巡逻',
                'V4 提供的主要功能包括：',
                '基础执法系统',
                '正常上下班机制',
                '接收任务',
                '完成案件',
                '战术部署系统',
                '玩家可以通过战术菜单部署：',
                '路障',
                '钉刺带',
                '其他现场控制设备',
                '支援系统',
                '玩家可以呼叫警力支援单位。',
                '支援单位能够：',
                '到达现场',
                '协助处理敌对目标',
                '单嫌疑人案件',
                'V4 的案件系统主要围绕 单嫌疑人事件。',
                '这一版本强调 稳定性与逻辑完整性，为后续版本打下基础。',
                'V5：架构级重构',
                '随着项目发展，旧架构逐渐积累大量技术债。',
                '因此在 TACTFR V5 中，整个系统进行了 全面重构。',
                '重构目标包括：',
                '模块化结构',
                '原有代码被拆分为多个独立模块，使系统更易维护与扩展。',
                '状态机驱动任务系统',
                '案件流程由 状态机（State Machine） 管理，例如：',
                '待接收',
                '进行中',
                '嫌疑人逃逸',
                '案件完成',
                '这一设计大幅减少任务逻辑错误。',
                '稳定的任务生命周期',
                '新的任务系统确保案件能够正确结束，避免重复生成或卡死。',
                '案件系统扩展',
                '在 V5 系列中，TACTFR 的案件系统开始扩展。',
                '目前系统已支持：',
                '多嫌疑人案件',
                '例如：',
                '双嫌疑人案件',
                '动态嫌疑人行为',
                '嫌疑人可能：',
                '步行逃跑',
                '驾车逃逸',
                '范围丢失机制',
                '当玩家失去嫌疑人时，系统会生成 搜索范围圈，提示可能位置。',
                '这一机制增强了追捕过程的真实感。',
                '战术系统',
                'TACTFR 的设计核心之一是 战术响应能力。',
                '系统允许玩家在任务中部署现场控制措施，例如：',
                '路障',
                '钉刺带',
                '支援单位',
                '这些功能使玩家能够通过 战术手段 而非单纯追逐来处理案件。',
                '架构理念',
                'TACTFR 的设计理念可以概括为三个原则：',
                '稳定优先',
                '所有功能都围绕稳定运行设计。',
                '模块化',
                '系统被拆分为多个独立模块，方便扩展。',
                '战术导向',
                '玩法强调执法决策与战术处理，而不仅仅是射击或追逐。',
                '当前进展',
                '截至 TACTFR 5.4.0，系统已经实现：',
                '模块化架构',
                '状态机任务系统',
                '多嫌疑人案件',
                '动态追捕机制',
                '战术部署与支援系统',
                '未来版本将继续扩展新的案件类型与战术功能。',
                '展望',
                'TACTFR 的长期目标是探索一种新的执法模拟方式：',
                '不是简单的任务脚本，而是一个持续运行的 城市执法系统。',
                '在这样的系统中：',
                '案件可以动态生成',
                '嫌疑人具有多种行为',
                '玩家需要使用战术手段进行处置',
                '洛圣都不再只是一个背景城市，而是一个持续运行的 执法环境。',
                'TACTFR 仍在不断演进。',
                '但它已经展示了一种可能性：',
                '在开放世界游戏中构建一个真正可持续的执法模拟系统。'
            ]
        },
        en: {
            title: 'TACTFR V4: Law Enforcement Loop System',
            date: 'March 03, 2026',
            category: 'Documentation',
            readTime: '8 min read',
            paragraphs: [
                'Tactical First Response',
                'Tactical Response System for Open-World Law Enforcement Simulation',
                'Abstract',
                'We introduce TACTFR (Tactical First Response) — a domestic independent police mod framework for Grand Theft Auto V, designed to transform open-world law enforcement gameplay into a structured, stable, and extensible tactical response system.',
                'TACTFR\'s design goal is not simply to add police missions, but to build a complete Law Enforcement Gameplay Loop, allowing players to experience the full law enforcement process from clocking in, receiving calls, handling cases to mission completion in a virtual city.',
                'In TACTFR V5, we performed an Architectural Rewrite of the entire system, introducing modular structure and state-machine-driven logic, transforming the system from early script logic to a sustainable extensible tactical law enforcement framework.',
                'As of now, TACTFR has developed to version 5.4.0 and continues to expand new case types and tactical features.',
                'Background',
                'Open-world games typically have rich urban environments, but law enforcement systems often rely on scripted tasks and lack continuously running structured logic.',
                'TACTFR\'s core goal is to solve three problems:',
                '1. Fragmented Law Enforcement Process',
                'Most police mods only provide single missions, lacking a complete law enforcement process.',
                '2. Insufficient System Stability',
                'Complex script logic easily leads to missions that cannot end or state desynchronization.',
                '3. Limited Extensibility',
                'The old architecture is difficult to support new case types or tactical mechanisms.',
                'TACTFR attempts to solve these problems through a unified task system and tactical framework.',
                'V4: Law Enforcement Loop System',
                'TACTFR V4 is an independent police mod that can run without complex dependencies.',
                'While its functionality is not the most complex, its core advantage is:',
                'Stable and complete law enforcement process.',
                'V4\'s core gameplay revolves around the Law Enforcement Loop:',
                'Player clocks in for duty',
                'Receives emergency calls',
                'Goes to the scene to handle cases',
                'Completes law enforcement process',
                'Mission ends and returns to patrol',
                'V4 provides main features including:',
                'Basic Law Enforcement System',
                'Normal clock in/out mechanism',
                'Receive missions',
                'Complete cases',
                'Tactical Deployment System',
                'Players can deploy through tactical menu:',
                'Roadblocks',
                'Spike strips',
                'Other scene control equipment',
                'Support System',
                'Players can call for police support units.',
                'Support units can:',
                'Arrive at the scene',
                'Assist in handling hostile targets',
                'Single Suspect Cases',
                'V4\'s case system mainly focuses on single suspect events.',
                'This version emphasizes stability and logical integrity, laying the foundation for subsequent versions.',
                'V5: Architectural Rewrite',
                'As the project developed, the old architecture gradually accumulated significant technical debt.',
                'Therefore, in TACTFR V5, the entire system underwent a comprehensive refactoring.',
                'Refactoring goals include:',
                'Modular Structure',
                'Original code was split into multiple independent modules, making the system easier to maintain and extend.',
                'State-Machine-Driven Mission System',
                'Case flow is managed by State Machine, for example:',
                'Pending',
                'In Progress',
                'Suspect Escaped',
                'Case Completed',
                'This design significantly reduces mission logic errors.',
                'Stable Mission Lifecycle',
                'The new mission system ensures cases can end correctly, avoiding duplicate generation or freezing.',
                'Case System Expansion',
                'In the V5 series, TACTFR\'s case system began to expand.',
                'The system now supports:',
                'Multi-suspect cases',
                'For example:',
                'Dual suspect cases',
                'Dynamic Suspect Behavior',
                'Suspects may:',
                'Flee on foot',
                'Escape by vehicle',
                'Range Loss Mechanism',
                'When the player loses the suspect, the system generates a search radius circle, indicating possible locations.',
                'This mechanism enhances the realism of the pursuit process.',
                'Tactical System',
                'One of TACTFR\'s core design elements is tactical response capability.',
                'The system allows players to deploy scene control measures during missions, such as:',
                'Roadblocks',
                'Spike strips',
                'Support units',
                'These features enable players to handle cases through tactical means rather than just pursuit.',
                'Architecture Philosophy',
                'TACTFR\'s design philosophy can be summarized into three principles:',
                'Stability First',
                'All features are designed around stable operation.',
                'Modular',
                'The system is split into multiple independent modules for easy extension.',
                'Tactical-Oriented',
                'Gameplay emphasizes law enforcement decisions and tactical handling, not just shooting or pursuit.',
                'Current Progress',
                'As of TACTFR 5.4.0, the system has implemented:',
                'Modular architecture',
                'State-machine mission system',
                'Multi-suspect cases',
                'Dynamic pursuit mechanisms',
                'Tactical deployment and support system',
                'Future versions will continue to expand new case types and tactical features.',
                'Outlook',
                'TACTFR\'s long-term goal is to explore a new way of law enforcement simulation:',
                'Not simple mission scripts, but a continuously running urban law enforcement system.',
                'In such a system:',
                'Cases can be dynamically generated',
                'Suspects have multiple behaviors',
                'Players need to use tactical means to handle situations',
                'Los Santos is no longer just a backdrop city, but a continuously running law enforcement environment.',
                'TACTFR continues to evolve.',
                'But it has already demonstrated a possibility:',
                'Building a truly sustainable law enforcement simulation system in open-world games.'
            ]
        }
    },
    n3: {
        overlay: 'NexusV',
        media: { type: 'image', src: 'Logo/I121.png', alt: 'NexusV V4' },
        zh: {
            title: '了解 NexusV V4',
            date: '2026年2月26日',
            category: '产品',
            readTime: '5 分钟阅读',
            paragraphs: [
                'NexusV：回归工具的本质，让创作更简单',
                '在沙盒游戏的广袤世界里，修改器不应该是复杂系统的负担，而应该是连接创意与现实的桥梁。NexusV（原 EF-Yuyu）的演进目标非常明确：用最轻量级的体量，提供最稳定的操作体验。我们不追求堆砌冗余的功能，而是致力于把每一个基础功能做到“好用”。',
                '1. 极简，但不简单 NexusV 的核心安装包仅只有 74KB。在动辄数百兆的插件环境中，我们坚持微内核设计。这意味着它几乎不占用系统资源，也不会干扰游戏的原生运行。从最初的内存 Hook 原型到现在的全功能版本，每一行代码的增加都是为了更好的兼容性与错误处理，而不是无谓的膨胀。',
                '2. 核心功能：赋予你掌控权 我们整理了玩家最常用的功能矩阵，并确保它们在各种场景下都能稳定触发：物理干预：实时调整重力、摩擦力及时间流速（Slow Motion）。实体调度：快速生成保镖或敌对目标，并能通过逻辑控制其行为。生存覆盖：包括无限耐力、水下呼吸及隐身模式，让你在探索时不再受限。',
                '3. 消除“操作隔阂” 一个好的工具应该让人感觉不到它的存在。为了消除第三方插件常见的违和感，我们重点优化了交互体验：平滑视角控制：针对自由相机（Free-cam），我们重构了输入算法。通过自定义灵敏度曲线 Sout = f(Imouse, γ)，解决了视角转动时的抖动与卡顿现象，让镜头推移更具电影感。原生级 UI：引入了非线性动画处理，菜单的每一次呼出与切换都力求贴合游戏原生的 HUD 质感。空间定位：整合了瞄准点瞬移技术，将位移逻辑与准星精确对齐，实现“指哪到哪”。',
                '4. 听取反馈，持续修复 NexusV 的迭代动力来自社区。在最新的版本中，我们重点解决了那些影响心情的“小问题”：规避场景冲突：彻底重构了脚本分发引擎，大幅降低了高负载场景下的崩溃频率。逻辑优化：修复了此前版本中偶尔出现的“掉入地底”问题，并重新梳理了武器分类逻辑，让查找更加直观。',
                '5. 加入我们 NexusV 已经从一个实验性脚本成长为一套成熟的工具集。它是一个开箱即用的、可靠的虚拟实验室，帮助你更自由地探索游戏的边界。BUG 反馈群：1079691553。获取方式：点击页面右上角“使用 NexusV 即可下载”。',
                '每一次按下按键，都应该得到确定的响应。NexusV，让修改回归简单。'
            ]
        },
        en: {
            title: 'Understanding NexusV V4',
            date: 'February 26, 2026',
            category: 'Product',
            readTime: '5 min read',
            paragraphs: [
                'NexusV: Return to the Essence of Tools, Make Creation Simpler',
                'In the vast world of sandbox games, a mod tool should not be a burden of complex systems—it should be the bridge connecting creativity and reality. The evolution goal of NexusV (formerly EF-Yuyu) is crystal clear: provide the most stable operating experience with the lightest possible footprint. We do not pursue stacking redundant features; instead, we strive to make every basic function "work well."',
                '1. Minimalist, Yet Not Simple The core installer of NexusV is only 74KB. In an environment where plugins often take up hundreds of megabytes, we adhere to a micro-kernel design. This means it barely consumes system resources and will not interfere with the game native operation. From the initial memory Hook prototype to the full-featured version today, every line of code added is for better compatibility and error handling, not unnecessary bloat.',
                '2. Core Features: Empowering You with Control We have organized the most commonly used feature matrix for players and ensured they can stably trigger in various scenarios: Physical Intervention: Real-time adjustment of gravity, friction, and time flow (Slow Motion). Entity Summoning: Quickly spawn bodyguards or hostile targets, with logical control over their behavior. Survival Overrides: Including infinite stamina, underwater breathing, and invisibility mode, freeing you from limitations during exploration.',
                '3. Eliminating the "Operation Gap" A good tool should make itself unnoticeable. To eliminate the common dissonance found in third-party plugins, we have focused on optimizing the interaction experience: Smooth Camera Control: For the free camera (Free-cam), we have rebuilt the input algorithm. Through a custom sensitivity curve Sout = f(Imouse, γ), we have solved the jitter and stuttering during camera rotation, making shot movement more cinematic. Native-Level UI: Introduced non-linear animation processing, making every menu call and switch strive to match the game native HUD texture. Spatial Positioning: Integrated aim-point teleportation technology, aligning displacement logic precisely with the crosshair, achieving "point to arrive."',
                '4. Listening to Feedback, Continuous Fixes The driving force behind NexusV iteration comes from the community. In the latest version, we have focused on fixing those "small issues" that affect mood: Avoiding Scene Conflicts: Completely restructured the script distribution engine, significantly reducing crash frequency in high-load scenarios. Logic Optimization: Fixed the occasional "falling underground" issue from previous versions and reorganized weapon classification logic for more intuitive searching.',
                '5. Join Us NexusV has grown from an experimental script into a mature toolkit. It is a ready-to-use, reliable virtual laboratory that helps you explore the boundaries of the game more freely. BUG Feedback Group: 1079691553. How to Get: Click "Use NexusV to Download" in the top right corner of the page.',
                'Every key press should receive a definite response. NexusV, bringing mods back to simplicity.'
            ]
        }
    },
    nexusv5: {
        overlay: 'NexusV V5',
        media: { type: 'image', src: 'Logo/NEXUSV.webp', alt: 'NexusV V5 Modifier' },
        zh: {
            title: '深入了解 NexusV V5 修改器',
            date: '2026年6月8日',
            category: '产品',
            readTime: '14 分钟阅读',
            paragraphs: [
                '摘要：NexusV V5（源码工程 EF_TSP.Core）是面向 GTA V 单机离线环境的游戏修改器，当前正式版本 v5.2.3。它基于 ScriptHookVDotNet 构建，以模块化架构覆盖玩家、载具、武器、世界、传送、保镖、特效等 200+ 可调条目，并内置 Rockstar Editor 工作流与创意玩法实验室。按 F6 呼出菜单，在洛圣都实现从数值微调到电影级布景的完整掌控。',
                '<strong>产品定位</strong>',
                'NexusV 修改器（游戏内标题为「Nexus修改器」）与 TACTFR、Sentience 同属 NexusV 套件，但职责不同：TACTFR 负责警务玩法闭环，Sentience 负责 AI NPC 对话，而 NexusV 修改器是你手中的万能控制台——调整物理规则、生成实体、导演镜头、触发灾变演出，一切围绕「让创作更简单」展开。',
                '从早期的 EF-Yuyu 实验脚本到今天的 V5 架构，我们始终坚持微内核思路：不堆砌无效入口，让每一个功能都有明确的执行链路和可感知的反馈。',
                '<strong>架构：模块化 + 分层菜单</strong>',
                'V5 的核心入口是 <code>GrandTrainer_New2</code>，采用栈式子菜单导航。顶层 14 个一级分类：玩家、载具、武器、服装、世界、传送、保镖、杂项、动作/摆造型、工具箱、R星编辑器、创意、特效、热咖啡娱乐、设置与版本/帮助。每个分类由独立 Module 类承载业务逻辑（PlayerModule、VehicleModule、WeaponModule、WorldModule 等），菜单只负责路由与状态展示，避免 V4 时代「所有逻辑堆在一个文件」的维护困境。',
                '配置通过 ConfigManager 持久化到本地 ini，支持延迟保存与脏数据标记；UIRenderer 独立负责绘制，包含层级面包屑、动态滚动条、霓虹描边与底部状态栏，长列表浏览不再迷失。',
                '<strong>内置 Rockstar Editor 工作流</strong>',
                'V5 的重大跃迁之一，是把 Rockstar Editor 能力直接嵌入修改器菜单，而不再要求玩家退出游戏切换外部工具。EditorManager 统一管理项目生命周期（新建 / 保存 / 加载 / 时间轴播放），并注册六个 IEditorModule 插件：',
                '放置物体（PropPlacementModule）—— 在场景中精确摆放道具，支持放置模式与实时预览；',
                '摄像机关键帧（CameraKeyframeModule）—— 记录与回放镜头轨迹，可调鼠标灵敏度；',
                '电影级特效（CinematicEffectsModule）—— 时间轴驱动的画面后期效果；',
                '时间缩放（TimeDilationModule）—— 与子弹时间、慢动作联动的节奏控制；',
                '角色动画（CharacterAnimationModule）—— 场景角色的姿态与动作编排；',
                '天气与时间（WeatherTimeModule）—— 拍摄环境的即时切换。',
                '项目文件序列化为 ini 格式，保存在 scripts/EditorProjects/ 目录，可在同一会话内反复加载，适合 Machinima 创作者与关卡设计师快速迭代。',
                '<strong>创意实验室：10 项次世代玩法</strong>',
                'InnovationLabModule 是 V5.2 起新增的「导演向」能力集，所有条目支持统一的创意半径（15–80m）与创意强度调节，并写入配置：',
                '引力漩涡 — 持续吸附周边行人与载具向玩家前方聚拢；',
                '斥力脉冲 — 瞬间向外弹飞周边目标，适合脱困与转场；',
                '猎手指令 — 命令武装行人围猎准星锁定目标；',
                '城市漫游 — 随机体验 NPC/动物视角并同步天气，或瞄准路人直接变身；',
                '撒钱 — 吸引路人哄抢的街头社会学实验；',
                '愿得一人心 — 与瞄准目标建立 T 键牵引连接；',
                '陨石雨 / 雷暴信标 — 区域级灾变演出；',
                '时停交通领域 — 冻结周边交通流，便于导演模式构图。',
                '版本/帮助菜单内提供完整的玩法说明与 UI 升级文档，更新日志与版本号统一由 TrainerReleaseInfo 维护，杜绝版本号分裂问题。',
                '<strong>经典能力矩阵（节选）</strong>',
                '玩家：无敌/锁血、通缉控制、超级跳跃、无限耐力与氧气、飞行/无重力、慢动作与子弹时间、自由相机、模型更换、金钱管理、伤害倍率、免疫模式、NPC/警察无视等。',
                '载具与武器：全品类载具生成、载具物理调教、武器分类浏览、传送枪/载具枪/金钱枪、一击必杀、连发、无后座等扩展射击模式。',
                '世界与工具：天气时间、重力枪、坐标记录器、实体检查器、绘制辅助、自动巡航、空袭模块、屏幕粒子特效、保镖编队。',
                '上述能力均通过独立 Module 的 OnTick 生命周期驱动，关闭功能时会主动恢复 native 状态（V5.2.2 起重点修复了无重力、慢动作截断等状态残留问题）。',
                '<strong>UI 与交互升级</strong>',
                'V5.2 对菜单体验做了系统级打磨：层级面包屑让跨层导航有据可循；动态滚动条跟踪当前选区；扫描底板与状态芯片强化开关确认感；方向键长按采用加速重复策略，连续翻页与调参更跟手。菜单缩放、每页可见条目数、标题/背景/高亮/文字四色预设均可自定义，热键支持用户自行绑定。',
                '<strong>技术规格</strong>',
                '运行时：GTA V Legacy / Enhanced + ScriptHookV + ScriptHookVDotNet 3；',
                '目标框架：.NET Framework 4.8；',
                '当前版本：v5.2.3（程序集 5.2.3.0）；',
                '默认热键：F6 打开菜单（可在设置中重绑）；',
                '部署：将 EF_TSP.Core.dll 放入 GTA V scripts 目录即可加载。',
                '<strong>与 V4 的差异</strong>',
                'NexusV V4 强调 74KB 微内核与基础物理/生存覆盖；V5 在此基础上完成了三件事：UI 渲染层彻底拆分（UIRenderer）、内置 Rockstar Editor 六模块工作流、以及 InnovationLab 创意玩法层。菜单条目从 V4 的「够用」扩展到 200+ 信息节点，但每条菜单都附带功能说明 tooltip，降低学习成本。',
                '<strong>获取与支持</strong>',
                '点击页面右上角「使用 NexusV」跳转官方下载页；',
                'BUG 反馈群：1079691553；',
                '请在单机离线环境下使用，使用前完整备份游戏目录与存档。',
                'NexusV V5 修改器不是外挂式的数值作弊器，而是一套面向创作者的工具平台——每一次按键，都应该得到确定的响应。',
                '—— NexusV 团队'
            ]
        },
        en: {
            title: 'Deep Dive: NexusV V5 Modifier',
            date: 'June 8, 2026',
            category: 'Product',
            readTime: '14 min read',
            paragraphs: [
                'Abstract: NexusV V5 (source project EF_TSP.Core) is a GTA V single-player offline trainer/modifier, currently at v5.2.3. Built on ScriptHookVDotNet, it uses a modular architecture covering 200+ tunable entries across player, vehicle, weapon, world, teleport, bodyguard, and effects — plus a built-in Rockstar Editor workflow and a Creative Lab. Press F6 to open the menu and take full control from stat tweaks to cinematic staging.',
                '<strong>Positioning</strong>',
                'The NexusV Modifier (in-game title: "Nexus修改器") sits alongside TACTFR and Sentience in the NexusV suite. TACTFR handles law-enforcement gameplay; Sentience handles AI NPC dialogue; the modifier is your universal control panel for physics, spawning, camera direction, and disaster staging — all in service of making creation simpler.',
                'From the early EF-Yuyu prototype to today\'s V5 architecture, we keep a micro-kernel philosophy: no dead menu entries, every feature with a clear execution path and perceptible feedback.',
                '<strong>Architecture: modular + layered menus</strong>',
                'The core entry is GrandTrainer_New2 with stack-based submenu navigation. Fourteen top-level categories: Player, Vehicle, Weapon, Clothing, World, Teleport, Bodyguard, Misc, Actions/Posing, Toolbox, Rockstar Editor, Creative, Effects, Hot Coffee, Settings, and Version/Help. Each category is backed by an independent Module class; menus only route and display state.',
                'ConfigManager persists settings to local ini with delayed save and dirty tracking. UIRenderer handles drawing with breadcrumb paths, dynamic scrollbars, neon outlines, and a bottom status bar.',
                '<strong>Built-in Rockstar Editor workflow</strong>',
                'A major V5 leap: Rockstar Editor capabilities embedded directly in the trainer menu. EditorManager manages project lifecycle (new/save/load/timeline playback) with six IEditorModule plugins: Prop Placement, Camera Keyframes, Cinematic Effects, Time Dilation, Character Animation, and Weather/Time. Projects serialize to ini under scripts/EditorProjects/.',
                '<strong>Creative Lab: 10 next-gen play modes</strong>',
                'InnovationLabModule (V5.2+) adds director-oriented capabilities with unified radius (15–80m) and strength controls: Gravity Vortex, Repulsor Pulse, Hunter Command, City Roam (random or aim-transform), Money Scatter, Bond Mode (T-key tether), Meteor Shower, Storm Beacon, and Traffic Stasis Field. Full docs live in Version/Help; TrainerReleaseInfo keeps version strings consistent.',
                '<strong>Core capability matrix (selected)</strong>',
                'Player: god mode, wanted control, super jump, infinite stamina/oxygen, flight/no-gravity, slow-mo/bullet time, free cam, model swap, money, damage multipliers, immunity, NPC/police ignore. Vehicles & weapons: full spawn catalog, physics tuning, teleport/vehicle/money guns, one-shot kill, rapid fire, no recoil. World & tools: weather/time, gravity gun, coordinate logger, entity inspector, autopilot, airstrike, screen FX, bodyguard squads.',
                '<strong>UI upgrades</strong>',
                'V5.2: breadcrumb navigation, dynamic scrollbar, scan-line backgrounds, status chips, accelerated key-repeat for paging. Menu scale, visible item count, and four color presets are customizable; hotkey is rebindable.',
                '<strong>Specs</strong>',
                'GTA V Legacy/Enhanced + ScriptHookV + SHVDN3; .NET Framework 4.8; v5.2.3; default F6; deploy EF_TSP.Core.dll to scripts/.',
                '<strong>vs V4</strong>',
                'V4 emphasized a 74KB micro-kernel and basic survival overrides. V5 adds: split UIRenderer, six-module Rockstar Editor workflow, and InnovationLab creative layer — 200+ menu nodes, each with a tooltip.',
                '<strong>Get it</strong>',
                'Click "Try NexusV" top-right; feedback group 1079691553. Use offline only; back up game and saves first.',
                'NexusV V5 is not a cheat overlay — it is a creator-facing tool platform. Every keypress should get a definite response.',
                '— The NexusV Team'
            ]
        }
    },
    sentienceV4C: {
        overlay: 'Sentience V4C',
        media: { type: 'video', src: 'Logo/V4C.mp4', poster: 'Logo/N1.jpg', fit: 'cover', alt: 'Sentience V4C' },
        zh: {
            title: '隆重推出 Sentience V4C',
            date: '2026 年 3 月 07 日',
            category: '产品',
            readTime: '10 分钟阅读',
            paragraphs: [
                '在最新的系统中，我们致力于解决虚拟世界中非玩家角色（NPC）的"瞬时性（Transience）"痛点。通过引入基于环境触发的感知引擎、持久化社会记忆账本以及本体特征对齐技术，我们成功构建了一套具备自恰逻辑的社会动力学模型。NPC 不再是静态的脚本响应者，而是拥有独立身份认知、长期社会记忆并能进行信息交换的具身智能体（Embodied Agents）。',
                '<div style="margin: 48px auto; max-width: 1080px; position: relative;"><video controls playsinline class="article-video" style="width: 100%; border-radius: 4px; display: block;"><source src="Logo/XC01.mp4" type="video/mp4">您的浏览器不支持视频标签。</video><div style="position: absolute; bottom: 12px; left: 16px; color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 500; text-shadow: 0 1px 3px rgba(0,0,0,0.8); pointer-events: none;">实机游玩画面，使用本地大模型强势驱动</div></div>',
                '从 V3 到 V4 加入自我认同的飞跃意义重大——知道自己是什么的 NPC，其行为方式与仅对刺激做出反应的 NPC 有着根本的不同。',
                '1. 响应式感知与自主行为环路 (Reactive Perception & Autonomous Behavioral Loops)',
                '我们重构了代理的底层检测逻辑，将其从被动的事件接收器升级为具备环境觉察能力的实体。',
                '环境事件侦测（Environment Detection）： 代理现在能实时处理包括高分贝声源（声谱检测）与异常物理运动（视觉碰撞检测）在内的多维信号。',
                '需求驱动状态机： 引入了自动化的需求优先级系统。通过将"安全"、"社交"、"目标"等核心维度进行量化，代理将根据当前环境熵（Entropy）的变化，自动在遮蔽、交互与探索行为间进行状态切换。',
                '当危险系数 D>threshold 时，安全需求将自动覆盖全局目标。',
                '2. 跨会话持久性记忆与社会声望场 (Persistent Relational Memory)',
                '为了打破虚拟世界的"无后效性"，我们实现了一套持久化的记忆存储协议。',
                '行为索引映射： 玩家的所有交互行为将被编码并存储于代理的长期记忆单元中。这种记忆是跨会话的，意味着玩家的过往行为将直接决定代理的初始信任阈值 Γ。',
                '语义标签系统（Dynamic Nicknaming）： 系统根据玩家的行为模式自动合成语义标签（如"Speedster"或"Outlier"）。这些标签不仅影响对话生成，更构成了代理对玩家的全局认知。',
                '3. 分布式社交传播与信息扩散 (Distributed Social Gossip)',
                '我们实现了一种基于邻域的信息交换机制，模拟了真实社会中的流言传播。',
                '代理间交互协议（Agent-to-Agent Socializing）： 当两个代理进入交互半径 R 时，系统会触发异步对话流。',
                '社会信息共享： 玩家的"声望记录"会作为数据包在代理间传递。这种机制确保了玩家的行为后果具有扩散性——即使在物理位置未曾抵达的区域，关于玩家的社会评价也可能已提前建立。',
                '4. 具身身份对齐与本体意识 (Embodied Identity & Ontological Alignment)',
                '这是实现深度沉浸感的关键。我们强化了 AI 对其承载实体（Entity）元数据的识别能力。',
                '元数据注入技术： AI 引擎现在能够实时读取并对齐其物理模型的属性（如姓名、性别、外观特征）。',
                '身份锚定对话： 在进行自然语言生成（NLG）时，代理将以其特定的身份背景为坐标系。例如，一个位于洛圣都的男性 NPC 将基于其预设的职业与地理背景生成语境对齐的回复，而非通用的预设模版。',
                '5. 压力响应与对抗性收敛 (Stress Response & Conflict Escalation)',
                '我们引入了情绪耐受度边界。当玩家通过交互输入（如特定按键触发的语言输入）持续施加负向反馈时，代理的情绪向量 E 将趋向于临界值 Ω。一旦触发收敛，代理的行为逻辑将从"社交模式"强制切换为"自卫对抗模式"，完成从平民到对抗者的逻辑跳变。',
                '结论',
                '通过这些系统的集成，我们正在接近一个真正的"活着的"虚拟社会。每一个 NPC 都是一个拥有记忆、感知自己姓名与性别、并能与其他个体交流"外部威胁"的独立个体。这不仅是感知技术的进步，更是向具身社会智能迈出的重要一步。',
                '现已向全球所有玩家开放下载，已安装的玩家建议覆盖安装，根据文档重新配置。现点击页面右上角的使用NexusV即可跳转至官方主页下载。'
            ]
        },
        en: {
            title: 'Introducing Sentience V4C',
            date: 'March 07, 2026',
            category: 'Product',
            readTime: '10 min read',
            paragraphs: [
                'In our latest system, we are committed to solving the "Transience" pain point of non-player characters (NPCs) in the virtual world. By introducing environment-triggered perception engines, persistent social memory ledgers, and ontological feature alignment technology, we have successfully constructed a self-consistent social dynamics model. NPCs are no longer static script responders, but embodied intelligent agents with independent identity cognition, long-term social memory, and the ability to exchange information.',
                '<div style="margin: 48px auto; max-width: 1080px; position: relative;"><video controls playsinline class="article-video" style="width: 100%; border-radius: 4px; display: block;"><source src="Logo/XC01.mp4" type="video/mp4">Your browser does not support the video tag.</video><div style="position: absolute; bottom: 12px; left: 16px; color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 500; text-shadow: 0 1px 3px rgba(0,0,0,0.8); pointer-events: none;">实机游玩画面，使用本地大模型强势驱动</div></div>',
                '1. Reactive Perception & Autonomous Behavioral Loops',
                'We have reconstructed the underlying detection logic of agents, upgrading them from passive event receivers to entities with environmental awareness capabilities.',
                'Environment Detection: Agents can now process multi-dimensional signals in real-time, including high-frequency sound sources (spectral detection) and abnormal physical movements (visual collision detection).',
                'Demand-Driven State Machine: An automated demand priority system has been introduced. By quantifying core dimensions such as "Safety", "Social", and "Goal", agents will automatically switch between hiding, interaction, and exploration behaviors based on changes in current environmental entropy.',
                'When danger coefficient D > threshold, safety demands will automatically override global goals.',
                '2. Persistent Relational Memory',
                'To break the "no-aftereffect" nature of virtual worlds, we have implemented a persistent memory storage protocol.',
                'Behavior Index Mapping: All player interaction behaviors will be encoded and stored in the agent\'s long-term memory unit. This memory is cross-session, meaning the player\'s past behavior will directly determine the agent\'s initial trust threshold Γ.',
                'Dynamic Nicknaming: The system automatically synthesizes semantic tags based on player behavior patterns (such as "Speedster" or "Outlier"). These tags not only affect dialogue generation but also constitute the agent\'s global cognition of the player.',
                '3. Distributed Social Gossip',
                'We have implemented a neighborhood-based information exchange mechanism, simulating gossip transmission in real society.',
                'Agent-to-Agent Socializing: When two agents enter interaction radius R, the system triggers an asynchronous dialogue flow.',
                'Social Information Sharing: The player\'s "reputation record" is passed as a data packet between agents. This mechanism ensures that the consequences of player behavior are diffuse—even in areas the player has never physically visited, social evaluations of the player may already be established.',
                '4. Embodied Identity & Ontological Alignment',
                'This is key to achieving deep immersion. We have strengthened the AI\'s ability to recognize metadata of its embodied entity.',
                'Metadata Injection Technology: The AI engine can now read and align attributes of its physical model in real-time (such as name, gender, appearance features).',
                'Identity-Anchored Dialogue: When generating natural language (NLG), agents will use their specific identity background as the coordinate system. For example, a male NPC in Los Santos will generate context-aligned responses based on their preset profession and geographical background, rather than generic preset templates.',
                '5. Stress Response & Conflict Escalation',
                'We have introduced emotional tolerance boundaries. When players continuously impose negative feedback through interaction inputs (such as language input triggered by specific keys), the agent\'s emotional vector E will tend toward the critical value Ω. Once convergence is triggered, the agent\'s behavioral logic will forcibly switch from "social mode" to "self-defense confrontation mode", completing the logical jump from civilian to adversary.',
                'Conclusion',
                'Through the integration of these systems, we are approaching a truly "living" virtual society. Each NPC is an independent individual with memory, awareness of its own name and gender, and the ability to communicate "external threats" with other individuals. This is not only a advance in perception technology, but an important step toward embodied social intelligence.',
                'Now available for download to all players worldwide. Players who have already installed are advised to overwrite install and reconfigure according to the documentation. Click "Use NexusV" in the upper right corner of the page to jump to the official homepage for download.'
            ]
        }
    },
    news1: {
        media: { type: 'image', src: 'Logo/H2.webp', alt: '携手共进' },
        zh: {
            title: '让我们携手共进',
            date: '2026年3月01日',
            category: '公司',
            paragraphs: [
                '在电子游戏史上，很少有作品能像《Grand Theft Auto V》（GTA5）这样，在发布十余年后依然保持着旺盛的生命力。这种持久生命力的核心，并不仅仅源于 Rockstar Games 的初始代码，更在于一个由开发者、艺术家和技术专家组成的全球化社群。',
                '今天，我们聚焦于那些隐匿在主流视野之外的小众模组（Niche Mods）。它们不以简单的"视觉增强"或"载具包"为目的，而是试图通过对游戏引擎底层逻辑的重构，探索虚拟世界的可能性边界。',
                '认知的重塑：非玩家角色（NPC）的神经网络化',
                '传统的游戏 AI 往往遵循预设的逻辑状态机。然而，目前一些前沿的小众模组正尝试将大型语言模型（LLM）的精简版集成到 RAGE 引擎中。',
                '通过这些模组，洛圣都的市民不再仅仅是随机移动的 x, y 坐标点。开发者利用向量空间模型（Vector Space Models）为每个 NPC 赋予了动态生成的背景故事和情绪维度。当玩家与一个路人交互时，后台正在进行实时的推理计算：',
                'P(Response | Interaction, Context) = ∏ᵢ₌₁ⁿ P(wᵢ | w₁...ᵢ₋₁)',
                '这种技术的应用，使得游戏从单纯的"模拟器"向"涌现式叙事空间"演进。',
                '物理层面的极致追求：流体力学与破坏系统',
                '在主流模组追求渲染分辨率提升至 4K 或 8K 时，一类极客模组正专注于改善物理引擎的精度。例如，"Advanced Fluid Dynamics" 模组重新定义了水体与载具的交互逻辑。',
                '在原生引擎中，阻力计算往往被简化为一个常数。而该模组引入了更接近真实环境的阻力公式：',
                'F_d = ½ ρ v² C_d A',
                '其中：ρ 代表虚拟空气或水的密度；v 是物体的相对速度；C_d 是受阻力系数；A 是参考面积。',
                '当玩家在雨夜高速行驶时，轮胎与地面积水的交互不再是视觉贴图，而是基于实时计算的牵引力损耗。这种微观层面的真实感，为追求极致拟真体验的硬核玩家提供了无可替代的沉浸感。',
                '隐形的美学：底层代码的"清洁与重构"',
                '在小众模组圈内，有一群被称为"优化艺术家"的开发者。他们不增加任何可见内容，而是专注于清理原有引擎中过时的函数调用和内存泄漏。',
                '通过重写内存分配算法，他们成功将游戏的 I/O 延迟降低了约 15% 至 25%。这种对 O(n) 复杂度的极致压缩，使得即便是在中低端配置的机器上，也能流畅运行原本负载极高的超大型地图拓展。',
                '我们为什么关注小众模组？',
                '在 OpenAI，我们相信技术的进步源于对边界的不断试探。GTA5 的小众模组开发者们展示了一种协作式创新（Collaborative Innovation）的典范：',
                '1. 去中心化的创意：没有任何一个官方团队能穷尽所有创意。',
                '2. 技术民主化：复杂的图形学与算法通过模组平台，变得触手可及。',
                '3. 可持续的生态：模组不仅延长了产品的生命周期，更为下一代游戏开发提供了实验场。',
                '结语',
                '"让我们携手共进"不仅仅是一个口号，它是对社区共创精神的最高致敬。无论是通过 C++ 注入新的逻辑，还是利用深度学习赋能虚拟生命，每一个微小模组的诞生，都是在洛圣都这片数字荒野上播下的一颗未来的种子。',
                '我们期待看到更多开发者加入这一行列，在 0 与 1 的交织中，构建出超越想象的平行现实。'
            ]
        },
        en: {
            title: 'Let\'s Work Together',
            date: 'March 01, 2026',
            category: 'Company',
            paragraphs: [
                'In the development history of NexusV, every cooperation is to build a stronger digital future.',
                'We are exploring the boundaries of AI with leading global partners to ensure that every technological breakthrough can benefit mankind.'
            ]
        }
    },
    news2: {
        media: { type: 'image', src: 'Logo/L2.webp', alt: 'TACTFR' },
        zh: {
            title: '在 TACTFR 中尝试接入 Sentience',
            date: '2026 年 03 月 03 日',
            category: '工程',
            readTime: '10 分钟阅读',
            paragraphs: [
                '在虚拟执法模拟领域，我们始终面临一个终极难题：如何打破预设对话脚本的"玻璃墙"？即便最复杂的决策树，也无法完全复现执法过程中那种不可预测的人性博弈。',
                '今天，我们正式分享在 TACTFR (Tactical Response) 框架中接入 Sentience AI 引擎的技术探索。这不仅仅是增加了一个功能，这是一次关于"执法透明度"与"交互涌现性"的实验。',
                '1. 愿景：从"交互菜单"到"自然语言干预"',
                '长久以来，TACTFR 的核心逻辑基于确定的状态机。当警员拦截嫌疑人时，交互被局限在 E、G 或小键盘的选项中。',
                '通过引入 Sentience，我们试图构建一种上下文感知（Context-Aware）的对话系统。警员不再是点击"询问证照"，而是可以直接通过语音提问："请出示你的证件，并解释你为什么在限速 60 的路段开到了 100？"',
                '2. 技术架构：构建双向感知桥梁',
                '将 Sentience 接入 TACTFR 需要处理极其复杂的实时数据流。我们不仅需要将语音转化为指令，还需要将 TACTFR 内部的实体状态实时推送到 LLM（大语言模型）的 Prompt 缓冲池中。',
                '状态映射向量化：我们将当前案件的背景（如：嫌疑人罪名 S_crime、情绪指数 E_index、持有武器 W_status）实时编码进模型输入。',
                '指令注入协议：当 AI 判定嫌疑人由于压力过大选择逃跑时，Sentience 会通过我们建立的自定义 API，向 TACTFR 逻辑引擎发送一个优先级为 P_0 的强制指令，触发底层的追捕 AI 逻辑。',
                'Output_behavior = f(Prompt_context, State_TACTFR)',
                '3. 执法沉浸感的质变',
                '在初步的集成测试中，我们观察到了令人惊叹的"涌现行为"：',
                '动态对峙：在一次持枪对峙场景中，AI 不再仅仅根据概率决定是否投降，而是会根据玩家说话的语气和威胁程度进行实时评判。如果你试图安抚对方，嫌疑人的压力值 P_stress 会呈现非线性下降。',
                '无限的口供可能性：每一名被捕者的背景故事都是动态生成的。通过 Sentience，你可以审讯出案件之外的细节，这些细节虽然不影响底层数值，但极大地丰富了"身为警官"的职业代入感。',
                '4. 克服摩擦力：延迟与确定性',
                '在公司内部测试中，最大的挑战依然在于推理延迟（Latency）。在瞬息万变的执法现场，即使是 200ms 的响应延迟也会破坏生死一瞬的紧张感。',
                '我们正在尝试以下方案进行优化：',
                '本地化轻量级模型预推断：在等待云端高质量响应的同时，使用本地的小型模型（如 4-bit 量化的版本）生成初步的非语言动作反馈。',
                '混合驱动模式：基础指令（如"趴下"）仍保留传统脚本触发，而复杂的谈话逻辑则交由 Sentience 处理。',
                '5. 结语：通往未来的第一步',
                '2026 年将是虚拟环境智能化爆发的一年。TACTFR 与 Sentience 的合流，是我们对"什么是可信的执法体验"给出的最新回答。',
                '我们正在重写 TACTFR 的底层交互逻辑，以容纳这些具备"灵魂"的虚拟市民。洛圣都的街头即将变得前所未有的喧嚣，而每一声呐喊背后，都有了一个真实的逻辑支撑。'
            ]
        },
        en: {
            title: 'Integrating Sentience in TACTFR',
            date: 'March 03, 2026',
            category: 'Engineering',
            readTime: '10 min read',
            paragraphs: [
                'In the field of virtual law enforcement simulation, we have always faced an ultimate challenge: how to break the "glass wall" of preset dialogue scripts? Even the most complex decision trees cannot fully reproduce the unpredictable human game in the law enforcement process.',
                'Today, we formally share our technical exploration of integrating the Sentience AI engine into the TACTFR (Tactical Response) framework. This is not just adding a feature; it is an experiment in "law enforcement transparency" and "interactive emergence".',
                '1. Vision: From "Interaction Menu" to "Natural Language Intervention"',
                'For a long time, the core logic of TACTFR has been based on deterministic state machines. When an officer intercepts a suspect, interactions are limited to E, G, or numeric keypad options.',
                'By introducing Sentience, we attempt to build a Context-Aware dialogue system. Instead of clicking "Ask for ID", officers can directly ask via voice: "Please show me your license and explain why you were driving 100 in a 60 zone?"',
                '2. Technical Architecture: Building a Two-Way Perception Bridge',
                'Integrating Sentience into TACTFR requires handling extremely complex real-time data streams. We not only need to convert speech into commands, but also push the entity states within TACTFR in real-time to the LLM\'s Prompt buffer.',
                'State Mapping Vectorization: We encode the context of the current case (such as suspect crime S_crime, emotion index E_index, weapon status W_status) into the model input in real-time.',
                'Command Injection Protocol: When the AI determines that the suspect chooses to flee due to excessive stress, Sentience will send a priority P_0 forced command to the TACTFR logic engine through our custom API, triggering the underlying pursuit AI logic.',
                'Output_behavior = f(Prompt_context, State_TACTFR)',
                '3. Qualitative Change in Law Enforcement Immersion',
                'In preliminary integration tests, we observed amazing "emergent behaviors":',
                'Dynamic Confrontation: In a hostage standoff scenario, the AI no longer decides whether to surrender based solely on probability, but makes real-time judgments based on the player\'s tone and threat level. If you try to calm the suspect, their stress value P_stress will show a nonlinear decrease.',
                'Infinite Confession Possibilities: The background story of each arrestee is dynamically generated. Through Sentience, you can interrogate details beyond the case. Although these details do not affect the underlying values, they greatly enrich the professional immersion of "being a police officer".',
                '4. Overcoming Friction: Latency and Certainty',
                'In internal company testing, the biggest challenge remains inference latency. In the ever-changing law enforcement scene, even a 200ms response delay can destroy the tension of life-and-death moments.',
                'We are trying the following solutions for optimization:',
                'Localized Lightweight Model Pre-inference: While waiting for high-quality cloud responses, use a local small model (such as a 4-bit quantized version) to generate preliminary non-verbal action feedback.',
                'Hybrid Drive Mode: Basic commands (such as "Get down") still use traditional script triggers, while complex conversation logic is handled by Sentience.',
                '5. Conclusion: The First Step Toward the Future',
                '2026 will be a year of explosive intelligence in virtual environments. The convergence of TACTFR and Sentience is our latest answer to "what is a credible law enforcement experience".',
                'We are rewriting the underlying interaction logic of TACTFR to accommodate these virtual citizens with "souls". The streets of Los Santos are about to become more bustling than ever, and behind every cry, there is now a real logical support.'
            ]
        }
    },
    news3: {
        media: { type: 'image', src: 'Logo/OAI_Systems_Blog_Card.webp', alt: '使用协议' },
        zh: {
            title: 'NexusV套件 使用协议、隐私政策与免责声明',
            date: '2026年5月26日',
            category: '公司',
            paragraphs: [
                '重要提示（建议先阅读此部分）',
                '本套件包含两类产品，数据处理方式截然不同，请分别留意：',
                '【游戏模组（TACTFR / NexusV 修改器 / Sentience）】默认使用本地部署的SFT微调Qwen模型（自带一键安装器），强烈推荐本地运行，在默认本地推理模式下，AI 对话相关上下文原则上不发送至开发者运营的服务器。如您选择使用云端推理（DeepSeek、OpenAI等），需自行提供API Key（保存在本地ini文件），所有数据传输风险及费用由您自行承担。',
                '【ChatAI 服务】为云端 AI 对话平台，需邮箱验证码登录。开发者运营云端网关并存储对话历史、用量记录、设备指纹等数据（详见第 4.6 节）。使用 ChatAI 服务即表示您同意本协议所述之个人信息处理方式。如您不同意，请勿注册或使用 ChatAI 服务。',
                'Sentience核心代码完全开源。开源仓库：https://github.com/NexusVAI/SENTIENCE',
                '游戏模组部分为单机娱乐模组，严禁用于违法用途或商业行为。',
                '使用本套件任一产品即视为您已阅读并同意本协议全部内容。',
                '',
                '更新日期：2026 年 5 月 26 日',
                '本协议自 2026 年 5 月 26 日起生效。先前版本以其原生效规则处理。本次更新主要修正 ChatAI 服务隐私说明（第 4.6 节），以如实反映当前已上线的数据处理实践。',
                '本使用协议（以下简称"本协议"）主要规范 NexusV 套件各模块的许可范围、使用限制、风险告知与责任边界；涉及个人信息与数据流转的说明适用于本套件当前已提供的功能，不构成对未来未上线云服务的承诺。',
                '1. 定义与产品说明',
                '1.1 "本套件"指由开发者发布的 NexusV 系列内容，当前包括：（1）TACTFR：用于 GTA V 单机离线环境的警务玩法增强模组；（2）NexusV 修改器：用于 GTA V 单机离线环境的数值与体验调整工具；（3）Sentience：用于 GTA V 游戏内 NPC 对话生成与互动增强的 AI 模组；（4）ChatAI：面向用户的 AI 聚合对话服务平台（以下简称"ChatAI 服务"），提供免费与付费（Pro / Pro+ / Pro Max 订阅及加油包）两种使用方式。',
                '1.2 Sentience 当前版本主要提供 AI 对话生成功能，支持本地模型推理及由用户自行配置的第三方云端模型接口。除非后续版本另有明确说明，当前版本不直接实现对 NPC 自主行为、移动、战斗或任务执行的实时控制。',
                '1.3 本套件为第三方非官方模组，与 Rockstar Games、Take-Two Interactive 及《Grand Theft Auto V》原权利人不存在授权、认可、合作或联名关系。本套件仅为技术演示与娱乐用途，不构成上述任何方的官方扩展或联名产品。',
                '1.4 本套件采用混合授权结构：Sentience 源代码中明确以 MIT 许可证发布的部分适用 MIT 许可证；TACTFR 与 NexusV 修改器当前版本及本套件内其他明确标注为闭源的程序、资源、UI 设计、安装器与配置内容，适用本协议约定的限制；第三方组件、模型权重及相关资源适用其各自原始许可。',
                '1.5 TACTFR、NexusV修改器与Sentience具有相对独立的功能模块和风险边界，适用本协议中与其功能相对应的条款。',
                '1.6 ChatAI 服务与上述游戏模组产品（TACTFR、NexusV 修改器、Sentience）在技术架构、功能定位和用户群体上完全独立。ChatAI 服务不依赖于任何游戏环境，不涉及游戏文件的修改或注入，不属于游戏模组范畴。ChatAI 服务作为生成式人工智能对话平台，适用本协议中与其功能相对应的条款，包括但不限于第 4.6 节（ChatAI 隐私说明）及第 5 节中涉及生成式人工智能的相关规定。就 ChatAI 服务而言，开发者作为云端网关运营者与平台提供方，依据《生成式人工智能服务管理暂行办法》及《个人信息保护法》承担相应数据处理者与服务提供者义务。',
                '1.7 "第三方组件"指本套件中嵌入或引用的由其他作者/组织提供的库、工具或二进制文件（详见第 3 节）。',
                '1.8 "个人信息"指以电子或者其他方式记录的与已识别或者可识别的自然人有关的各种信息，不包括匿名化处理后的信息（定义依据《个人信息保护法》第四条）。',
                '1.9 "个人信息处理者"指在个人信息处理活动中自主决定处理目的、处理方式的组织或个人。就 ChatAI 服务涉及的个人信息处理，开发者为个人信息处理者。',
                '⚠️ Rockstar/GTA V 风险独立警告：即使在单机离线模式下，使用任何注入式模组（包括但不限于本套件中的 TACTFR、NexusV 修改器及 Sentience 模块）仍存在极低概率因 Rockstar 未来政策变化、反作弊检测机制更新或游戏版本迭代而导致存档损坏、游戏异常运行、账号异常或封禁风险。在适用法律允许的最大范围内，除因开发者故意或重大过失造成的损害外，开发者不对上述风险承担责任。强烈建议您在使用本套件前：（1）完整备份整个 GTA V 游戏根目录及所有存档文件；（2）仅在完全断网的单机离线模式下使用；（3）避免在已关联重要游戏进度或付费内容的账号上使用。',
                '2. 授权与许可声明',
                '2.1 Sentience 源代码中以 MIT 许可证发布的部分适用 MIT 许可证文本；本协议不应被解释为削减用户依据 MIT 许可证依法享有的权利。',
                '2.2 TACTFR与NexusV修改器版本声明：TACTFR 与 NexusV 修改器的早期历史版本曾进行过开源，相关旧版本代码继续适用当时的开源许可。但本套件当前所包含的 TACTFR 与 NexusV 修改器最新版本均为闭源状态。其原创代码、UI 设计及核心逻辑保留所有权利，仅授权用户进行个人、非商业、单机线下的娱乐使用。',
                '2.3 许可范围边界说明：本套件采用分层授权架构：\n（1）Sentience 模块（开源部分）：独立源代码（不含模型权重）适用 MIT 许可证，您可以自由使用/修改/分发，但必须同时遵守所用模型的原始许可；\n（2）专属闭源部分：本套件当前包含的 TACTFR 及 NexusV 修改器的闭源程序、UI 设计、核心逻辑以及预设配置文件，开发者在用户持续遵守本协议的前提下，授予用户一项个人的、非独占的、不可转让的、不可转授权的有限使用许可，仅限个人、非商业、单机离线娱乐用途。如用户违反本协议，开发者有权终止该许可。未经开发者书面授权，严禁对上述闭源二进制文件进行修改、逆向工程、反编译、提取代码或二次分发（包括但不限于打包售卖、付费代安装等任何形式的商业变现行为）。本协议中关于禁止修改、逆向工程、二次分发等限制，仅适用于本套件所含闭源组件、闭源资源文件、专有 UI 设计、安装器及其他明确标注为非开源的内容，不适用于依法可自由使用的开源部分及第三方许可另有授权的部分。\n（3）Sentience SFT 微调模型权重：以 Qwen 原始许可协议（详见模型文件夹内 LICENSE 及 Qwen 官方许可链接：https://github.com/QwenLM/Qwen3.5/blob/main/LICENSE）提供。开发者不主张对基础模型的所有权，仅共享微调后的权重文件。相关基础模型、权重或衍生权重的使用、分发与再利用，应同时遵守对应模型文件夹中附带的许可文件及其上游官方许可要求。开发者仅对其自行完成的微调与整合工作主张相应权利，不对基础模型本身主张所有权。\n上述分层授权意味着：即使您从源码自行编译整合包并使用，若未获书面授权，仍需遵守本协议对专属闭源部分的限制。第三方组件权利以其原始许可为准，本协议不得限制。\n如本协议与适用于特定开源组件、第三方库、模型权重或其他第三方内容的原始许可证发生冲突，就该特定内容而言，以其原始许可证及适用法律的强制性规定为准；本协议仅在不冲突的范围内补充适用。\n豁免条款：开发者允许并鼓励用户基于使用本套件的游戏过程进行录屏、剪辑、直播及在主流内容平台发布，用户因平台广告分成、直播打赏、会员收益等通常平台机制获得的收益，不视为本协议所禁止的未经授权商业分发或商业转售。但用户不得借此对本套件本身进行收费下载、付费代安装、授权倒卖、会员专享分发或其他针对软件本体的商业化利用。创作者必须严格遵守本协议第 5 节关于"深度合成标识"的合规要求。',
                '3. 第三方组件与AI模型',
                '3.1 游戏模组部分：本套件使用 ScriptHookV（不随包分发，请用户自行官网下载）、ScriptHookVDotNet、NAudio、Newtonsoft.Json。本套件仅作为脚本补丁运行，不包含、不修改、不分发任何原游戏（GTA V）的核心二进制文件或任何受版权保护的游戏资源（包括但不限于模型、纹理、音频、动画数据等）。本套件仅包含第三方逻辑脚本及开发者原创的配置文件。用户需自行承担因安装 ScriptHookV 等第三方注入工具导致的软件冲突或系统不稳定风险。',
                '3.2 Sentience默认模型为基于 Qwen 系列模型的 SFT 微调权重（如 Qwen2.5/Qwen3）。相关基础模型、微调权重及衍生权重的使用、分发与再利用，应遵守模型文件夹内附带的许可文件及其上游官方许可要求。',
                '3.3 游戏模组云端模式需用户自备：OpenAI API、DeepSeek API 等，使用即视为您已同意其服务条款与AUP。LM Studio为可选本地工具。',
                '3.4 ChatAI 服务第三方组件：ChatAI 服务后端依赖以下第三方服务：（1）Supabase（supabase.com）：提供用户认证、数据库托管及存储服务，其数据处理受 Supabase 隐私政策（supabase.com/privacy）约束，服务器位于新加坡；（2）Cloudflare：通过 Workers 域名 chat.nexusvai.xyz 承载 chat-gateway 与 api-gateway 流式推理网关，并提供 Turnstile 登录人机验证，其数据处理受 Cloudflare 隐私政策（cloudflare.com/privacypolicy）约束；（3）第三方 AI 模型服务商：提供实际推理服务，详见第 4.6 节第（9）项。开发者不对上述第三方的数据处理行为承担责任。',
                '4. 隐私与数据说明',
                '4.1 默认本地推理模式：Sentience 默认优先使用本地部署的 SFT 微调 Qwen 模型进行推理。在默认本地推理模式下，与 NPC 对话相关的上下文和玩家输入原则上不经过开发者运营的服务器。在本套件当前版本的默认设计下，开发者不主动收集用户的游戏对话内容、个人身份信息或用户自行配置的第三方 API Key。',
                '4.2 用户主动启用的第三方云端模式：如用户主动在本地配置第三方模型服务商的 API Key 并启用云端模式，则相关对话数据将由用户设备直接发送至其所选服务商（如 OpenAI、DeepSeek 等），开发者不提供该等请求的中转、托管或代付服务。云端模式产生的网络通信、费用、账号风控及服务可用性风险，由用户自行承担。用户需遵守所选API服务商的服务条款与隐私政策。',
                '4.3 本地配置文件与 API Key：用户自行配置的 API Key 可能以明文形式保存在本地配置文件中。用户应自行妥善保管该文件，不应在公共设备、共享设备或公开仓库中泄露相关信息。请勿分享配置文件或上传至公开仓库，强烈建议优先使用本地模式以避免任何数据传输和费用风险。',
                '4.4 用户输入内容提示：用户不应在与 Sentience 的对话中输入真实姓名、身份证号、银行卡信息、家庭住址、电话号码、支付凭证、账号密码等高度敏感信息；因自行输入敏感信息导致的信息泄露、第三方处理风险、账号风险或其他法律后果，由用户自行承担。',
                '4.5 已上线云端服务说明：ChatAI 服务已上线由开发者运营的云端推理网关（chat-gateway）、账号系统（基于 Supabase Auth，使用邮箱验证码登录）及付费订阅系统（Pro / Pro+ / Pro Max 三档月度订阅 + 加油包）。该等服务的具体数据处理实践详见第 4.6 节。用户本地日志可自行删除。',
                '4.6 ChatAI 服务隐私说明：ChatAI 服务采用云端处理架构，用户对话请求通过开发者运营的云端网关（chat-gateway）转发至第三方 AI 模型进行推理，推理结果经网关返回用户界面。ChatAI 服务的具体数据处理实践如下：',
                '（1）对话内容存储：用户通过 ChatAI 服务产生的对话历史存储于开发者运营的云端数据库（Supabase），包括对话标题、消息内容、所用模型等信息。对话历史与用户账号关联，用于支持跨设备同步、对话续接及历史回看功能。开发者不会将用户对话内容用于训练 AI 模型。用户可在 ChatAI 界面中主动删除对话历史，删除后开发者不再持有该等数据。',
                '（2）用量记录：开发者记录每次 AI 模型调用的用量明细（包括用户 ID、模型 ID、输入/输出 Token 数、调用时间、调用是否成功等），用于配额管控、用量统计及计费结算。用量记录不包含对话原文内容。',
                '（3）账号与身份信息：使用 ChatAI 服务需通过邮箱验证码登录（基于 Supabase Auth）。开发者获取并存储用户注册邮箱地址。付费订单处理过程中，开发者获取并存储用户提交的邮箱及 QQ 号，用于订单审核与激活码发放。开发者不要求用户提供手机号、真实姓名或身份证号。',
                '（4）设备指纹与反滥用：为防止多账号滥用及保障服务公平性，开发者在用户登录后采集设备/浏览器指纹信息（包括但不限于 Canvas/WebGL/Audio 指纹、WebRTC IP、User-Agent、屏幕分辨率、时区、语言、硬件参数等），综合生成 visitor_id 并存储于服务端，用于跨账号关联检测。开发者同时记录用户 IP 地址及地理信息缓存，用于安全审计与反滥用。',
                '（5）错误遥测：ChatAI 服务在用户同意后，采集浏览器端未捕获异常信息（包括 UA、当前 URL、视口尺寸、异常 message 与 stack、最近 10 条 fetch 请求的 URL 与状态码），用于问题排查与产品改进。用户可拒绝遥测，拒绝后不影响正常使用。',
                '（6）用户记忆功能：ChatAI 服务提供可选的用户记忆功能，允许用户设置个性化偏好信息（每用户最多 5 条，每条不超过 100 字），该等信息存储于云端数据库，用于在后续对话中为 AI 提供上下文。用户可随时关闭或删除该功能中的记忆内容。',
                '（7）Arena 竞技场：ChatAI 服务提供模型对比竞技场功能。用户提交的 prompt 及模型返回的 response 存储于服务端，用于投票统计与模型评估。竞技场数据与用户账号关联。',
                '（8）加密传输：所有用户与 ChatAI 服务之间的数据传输均通过 HTTPS 加密通道完成。',
                '（9）第三方模型：ChatAI 服务聚合的 AI 模型由第三方提供，开发者通过云端网关将用户对话请求转发至第三方模型服务商进行推理。用户对话内容在推理过程中经由第三方模型服务商的服务器处理，该等处理受第三方服务商各自的隐私政策与服务条款约束。开发者不对第三方模型服务商的数据处理行为承担责任，用户应自行了解并同意相关第三方的服务条款。',
                '（10）付费系统：ChatAI 服务提供 Pro / Pro+ / Pro Max 三档月度订阅及加油包购买。订阅状态、月度配额消耗、加油包余额及用量流水存储于服务端，用于计费与权益管理。付费通过人工订单审核 + 激活码兑换方式完成，开发者不直接处理支付信息。',
                '（11）封禁与申诉：如用户违反本协议或被系统检测为滥用，开发者有权封禁账号。被封禁用户可通过申诉流程提交申诉请求，申诉信息存储于服务端。',
                '（12）敏感信息提示：用户不应在与 ChatAI 服务的对话中输入真实姓名、身份证号、银行卡信息、家庭住址、电话号码、支付凭证、账号密码等高度敏感信息；因自行输入敏感信息导致的信息泄露或法律后果，由用户自行承担。',
                '（13）数据保留期限：对话历史在用户主动删除前持续保留；用户删除对话后，开发者将在 30 日内从生产数据库移除，备份系统中的副本将在 90 日内清除。用量记录保留至对应订阅周期结束后 12 个月，用于账务核对与争议处理。设备指纹数据在用户最后一次登录后保留 180 日。封禁记录与申诉记录保留至解封后 12 个月。法律法规要求更长期限保留的，从其规定。',
                '（14）跨境传输：ChatAI 服务后端数据库托管于 Supabase（服务器位于新加坡）。用户数据在传输至新加坡的过程中受到 HTTPS 加密保护。开发者已评估该等跨境传输的必要性，并确认 Supabase 提供的数据安全保障措施符合适用法律要求。如用户所在地的强制性法律对数据出境有额外要求，以该等强制性法律规定为准。',
                '（15）Cookie 与本地存储：ChatAI 服务在用户浏览器中使用以下本地存储机制：（a）Supabase Auth 会话令牌（localStorage 键名 cancri_supabase_auth），用于维持登录状态，用户关闭浏览器或主动登出后失效；（b）匿名标识符（localStorage 键名 cancri_anon_id），用于遥测与指纹关联；（c）遥测同意状态（localStorage 键名 cancri_telemetry_consent），记录用户是否同意错误回传；（d）用户偏好设置（localStorage 键名 theme、lang 等），用于保存主题与语言偏好。ChatAI 服务不使用追踪型 Cookie。用户可随时通过浏览器设置清除上述本地数据。',
                '5. AI 生成内容与用户责任',
                '5.1 游戏模组（Sentience）工具属性说明：Sentience 在当前版本中主要作为本地运行的 AI 对话增强工具提供。对于用户自行配置并调用的第三方云端模型服务，开发者仅提供本地接口集成，不参与第三方模型服务的实际运营。如适用法律将本套件的特定功能认定为生成式人工智能相关服务的一部分，开发者将在法律要求的范围内履行相应义务。用户在使用本套件生成内容时，应自行遵守所在国家及地区的相关法律法规（包括但不限于《互联网信息服务深度合成管理规定》等）。',
                '5.2 ChatAI 服务生成式AI合规：ChatAI 服务作为生成式人工智能聚合平台，其输出内容由第三方 AI 模型基于用户输入自动生成。开发者运营云端网关进行请求转发、配额管控与用量记录，不参与 AI 模型的实际推理过程，不对任何特定输出内容拥有著作权或编辑控制权。依据《生成式人工智能服务管理暂行办法》，开发者履行以下义务：（1）提供内容标注：ChatAI 界面中 AI 生成的内容均带有明确标识，以区分人工内容与机器生成内容；（2）建立举报机制：用户可通过 ChatAI 界面或第 10 节提供的联系方式举报违法或不当 AI 输出，开发者将在合理时间内处理；（3）用户生成内容管理：用户使用 ChatAI 服务生成的内容，应自行判断其合法性、准确性与适用性，并自行承担因使用该等内容所产生的法律后果。用户不得利用 ChatAI 服务生成违反当地法律法规的内容，包括但不限于虚假信息、侵权内容、违法有害信息等。开发者保留在发现违法违规使用行为时采取内容过滤、限制或终止用户访问 ChatAI 服务的权利。',
                '用户理解并同意，Sentience 作为一个开放接口，其输出完全取决于所加载的模型权重。如用户选择加载开发者分享的测试权重，应自行承担内容合规风险。',
                'AI输出的独立性与虚构属性：Sentience 生成的对话、叙事、观点及角色表达均为模型基于上下文自动生成的虚构内容，仅供游戏娱乐体验，不应被理解为开发者、原游戏权利人、模型提供方或任何现实主体的真实立场、建议或事实陈述。',
                '不得作为现实依据：用户不得将相关输出作为医疗、法律、投资、执法、新闻或其他现实决策的依据。模型生成的任何有关医疗、法律、投资等专业领域的建议均为虚构，严禁将其视为现实参考。',
                '不可预测性：模型输出具有不确定性，可能包含错误、虚构、冒犯性或不适当内容；在适用法律允许的最大范围内，除因开发者故意或重大过失造成的损害外，开发者不对模型在任意时刻的具体输出承担责任。不同模型、量化版本、微调权重与提示词设置可能导致输出质量、安全性和行为风格存在显著差异。',
                '内容过滤与上报机制：本套件可能提供内容过滤、提示词约束或输出限制等辅助性风险控制措施，但该等措施不构成对任何输出合法性、准确性、适宜性或完整性的保证，也不能保证拦截所有不当内容。并强烈推荐使用本地模式以降低风险。请及时通过邮箱（见第10节）上报违法或严重冒犯内容。',
                '深度合成标识：用户在对外公开传播含有 Sentience 生成对话、剧情或角色互动内容的视频、直播切片、图文或其他素材时，应按照适用法律法规及平台规则，以简介、画面标注、字幕说明或其他足以使公众知悉的方式，明确提示其中包含 AI 生成或虚构内容。用户不得将该等内容包装为真人真实言论、官方公告、真实新闻、真实执法记录或其他足以误导公众的材料。否则由此引发的一切监管风险由您自行承担。',
                'TACTFR的警察/嫌疑人AI仅为游戏娱乐模拟，不得用于真实执法训练、不得冒充真实机关。',
                '禁止用途：严禁利用本套件生成并在公共网络空间传播任何违反当地法律法规之内容，包括但不限于色情、暴力恐怖、仇恨言论、侵害隐私或诽谤等内容。开发者保留对恶意滥用行为追究法律责任的权利。',
                '6. 使用限制与禁止行为',
                '6.1 年龄限制：本套件面向成年人提供；如用户所在地法律对类似内容或游戏模组的使用年龄有更高要求，从其规定。您须在首次使用前自行确认符合上述限制；若您未满 18 周岁或不具备完全民事行为能力，请立即停止使用并删除本套件。开发者不具备年龄核验技术手段，因虚假声明导致的一切后果由用户自行承担。ChatAI 服务不面向未满 14 周岁的未成年人提供个人信息处理服务；如开发者在处理过程中发现用户为未满 14 周岁的未成年人，将依法通知其监护人并寻求追认，或删除其个人信息。',
                '6.2 游戏模组联机限制：严禁在GTA Online、Rockstar官方多人服务或任何其他未获允许的联机环境中加载、调用或测试本套件的任何功能，由此导致的封号由您自负。用户不得利用本套件规避、干扰或测试游戏服务方的安全机制、反作弊系统、账号风控系统或内容审核规则。出口管制合规：用户在使用云端API模式时，需自行确保其网络环境和调用行为符合所选API服务商所在地的出口管制法律法规（如美国的 EAR 规定）。因用户违规调用API导致的封号、IP拉黑或法律追责，在适用法律允许的最大范围内，除因开发者故意或重大过失造成的损害外，开发者不承担连带责任。',
                '6.3 商业变现禁止：禁止将本套件用于任何违法用途或以任何方式进行商业变现（如未经授权的付费分发、代售、代练、代装、收费分发、倒卖、捆绑销售、引流变现或其他未经授权的商业目的），除非事先获得开发者书面授权。严禁任何形式的"倒卖"、"整合包收费"、"赞助即获取"等行为。若发现此类行为，开发者将配合原版权方（Rockstar Games / Take-Two Interactive）追究侵权者的法律责任。',
                '6.4 逆向工程限制：除非第三方组件原始许可允许，您不得对开发者的专有部分实施逆向工程、反编译或反汇编（Sentience按MIT许可除外）。对以开源许可分发的组件，请按其原始许可执行。本协议中关于禁止修改、逆向工程、二次分发等限制，仅适用于本套件所含闭源组件、闭源资源文件、专有 UI 设计、安装器及其他明确标注为非开源的内容，不适用于依法可自由使用的开源部分及第三方许可另有授权的部分。',
                '6.5 游戏模组离线推荐：推荐在单人/离线模式下使用本套件以降低因修改游戏文件而被官方封禁的风险；开发者不保证在线多人模式使用的安全性或不会触发游戏服务方的处罚。',
                '6.6 ChatAI 服务使用限制：（1）账号共享禁止：每个 ChatAI 账号仅限本人使用，禁止将账号凭据（包括邮箱、验证码、会话令牌等）提供给第三方使用。开发者有权检测并处置共享账号，包括但不限于重置会话、暂停配额或封禁账号。（2）配额滥用禁止：用户不得通过多账号注册、设备指纹伪造、自动化脚本或其他技术手段规避免费配额限制或付费订阅的用量上限。开发者有权通过设备指纹、IP 分析等技术手段检测并处置滥用行为。（3）自动化访问禁止：用户不得使用爬虫、机器人、自动化脚本或其他非官方授权的方式批量访问 ChatAI 服务接口，包括但不限于批量抓取对话内容、自动提交 prompt、自动化投票等。开发者有权对自动化访问行为进行限制或封禁。（4）服务滥用禁止：用户不得利用 ChatAI 服务进行任何损害服务稳定性、公平性或其他用户体验的行为，包括但不限于恶意占用资源、攻击服务基础设施等。',
                '7. 免责声明（保证与责任限制）',
                '7.1 按原样提供：本套件按"原样"（AS IS）提供，开发者对本套件不作任何明示或默示的保证，包括但不限于对适销性、对特定用途适用性、免侵权或无缺陷的保证。',
                '7.2 不担保可用性：开发者不保证本套件将持续不间断、安全、无错误或完全符合用户期望；也不保证任何第三方服务或模型的可用性与稳定性。本地模型推理对用户设备的 CPU、GPU、显存、内存、磁盘空间及系统环境存在要求。开发者不保证所有设备均可流畅运行本地模型，也不保证本地模型输出符合用户预期。',
                '7.3 风险自负：在适用法律允许的最大范围内，除因开发者故意或重大过失造成的损害外，开发者不对用户因下载、安装、配置或使用本套件所遭受的间接损失、附带损失、后果性损失、利润损失、账号风险（包括但不限于被官方封禁）、存档损坏或第三方服务不可用承担责任。法律明确禁止排除或限制的责任，不因本协议而排除。',
                '7.4 非官方渠道获取风险：本套件仅在开发者指定的官方渠道（如 Github、指定模组论坛等）免费发布。对于用户从非开发者公布的官方渠道获取的安装包、整合包、镜像文件、网盘转载或二次封装版本，开发者无法保证其真实性、完整性、安全性与可用性。用户因此遭受的账号风险、财产损失、恶意软件感染或数据泄露风险，由用户自行判断并承担相应后果。',
                '7.5 责任限额：在适用法律允许的最大范围内，除因开发者故意或重大过失造成的损害外，开发者对因本套件引起或与之相关的任何间接损害、特殊损害、惩罚性损害或后果性损害不承担责任。对于 ChatAI 付费用户，开发者因本套件所导致的可归因特定责任的直接损害，最高赔偿以用户最近 12 个月内向开发者实际支付的订阅费用为限；对于免费用户，最高赔偿不超过 100 元人民币或法律规定的最低赔偿下限，取其中较高者。若某一司法管辖区法律不允许完全排除责任，则开发者的责任范围以该法律允许限制的最大范围为限，但不影响法律规定不得排除或限制的责任。',
                '7.6 ChatAI 付费订阅退款政策：ChatAI 订阅采用激活码兑换方式，激活后立即生效，未使用的剩余配额不作现金退还。如订阅周期内服务因开发者原因出现严重缺陷（单次连续中断超过 72 小时且开发者未提供补偿），用户可向开发者申请按剩余天数比例补偿。加油包一经激活消耗即不可退还；如全新未使用，可在激活后 7 日内向开发者申请退还。法律强制性规定的维权权利，不受本政策限制。',
                '7.7 安装器与安全软件拦截：本套件可能包含用于部署本地模型、依赖组件或运行环境的安装器/启动器。该工具仅用于简化本地部署流程，不改变用户对第三方组件、模型许可及游戏环境风险的自行判断义务。由于安装器、脚本注入、模型部署或目录写入行为可能被安全软件误报、被系统权限机制拦截，用户应在使用前自行备份相关目录并确认来源安全。"一键安装器"及脚本注入功能可能会被部分杀毒软件（如 Windows Defender 等）误报为风险文件。此为无数字签名的独立游戏补丁的常见现象。用户需自行判断并决定是否添加信任。在适用法律允许的最大范围内，除因开发者故意或重大过失造成的损害外，因安装器运行、权限不足或被杀毒软件误杀导致的游戏无法启动、文件损坏，开发者不承担责任。强烈建议在使用安装器前备份您的 GTA V 游戏根目录。如安装器需联网下载模型或依赖文件，相关网络请求仅用于获取用户主动选择安装的资源。',
                '7.8 API 密钥安全：为了方便用户在不同 AI 工具间迁移配置，本套件采用了通用的明文配置文件格式。用户一旦将 API Key 写入该文件，即视为接受该等存储方式的公开性，并承诺自行采取加密磁盘、限制文件权限等措施保护其私钥。请勿分享该文件，不要在公共电脑或多人共用的设备上配置云端API功能。在当前版本已提供功能范围内，开发者不通过自建服务器接收、转存或查看该等 Key，但无法阻止您自行泄露。因泄露、被盗刷产生的费用由您全责承担。',
                '7.9 本节责任限制及免责并不旨在规避对因故意或重大过失所导致的法定不可免除责任。',
                '7.10 用户赔偿：您同意，因您违反本协议（包括但不限于输入违法违规内容、泄露API Key、违反Qwen或其他模型发行方的AUP、将本套件用于商业用途等），而导致开发者遭受第三方索赔、行政处罚、诉讼或经济损失（包括合理的律师费用），您应赔偿开发者因此遭受的合理损失。',
                '8. 维护、更新与协议变更',
                '8.1 开发者可不定期对本套件进行更新、维护或功能变更。对于本协议的修改，开发者将在模组发布页/仓库主页发布变更说明并标注生效日期。对于影响用户主要权利义务、数据处理方式、授权边界或责任限制的重要变更，开发者将通过发布页公告、仓库说明、更新日志或首次启动提示中的一种或多种方式进行显著通知，并标注生效日期。用户在变更生效后继续安装、启动或使用相关版本的，视为接受更新后的协议；如不同意，应停止使用相应版本并删除相关文件。',
                '8.2 对于 ChatAI 服务涉及个人信息处理方式的重大变更（包括但不限于新增收集类型、变更处理目的、变更数据出境目的地等），开发者将通过 ChatAI 界面弹窗或注册邮箱通知等方式单独告知用户，并在用户重新确认同意后方可继续处理；如用户不同意变更，可停止使用 ChatAI 服务并申请删除其个人信息。',
                '8.3 若用户不同意任何变更，应停止使用并删除本套件。',
                '9. 知识产权',
                '9.1 Sentience源代码中以 MIT 许可证发布的部分适用 MIT 许可证文本；本协议不应被解释为削减用户依据 MIT 许可证依法享有的权利。',
                '9.2 闭源组件的知识产权：本套件中的 TACTFR 与 NexusV 修改器当前版本系开发者的闭源作品。其全部软件著作权及相关知识产权均归开发者所有。任何针对历史开源版本的许可协议均不适用于本套件中的当前闭源版本。未经开发者书面许可，任何人不得针对本套件中的闭源组件实施修改、破解、二次分发或商业化利用。',
                '本套件中引用的第三方商标、游戏资产与品牌之知识产权归原权利人所有，用户不得主张任何所有权或暗示官方授权。',
                '10. 投诉、问题反馈与联系信息',
                '10.1 联系渠道：若您发现安全问题、违法或严重不当的 AI 输出、或需要行使数据主体权利（见第 10.2 节），请通过下列优先顺序与开发者联系：',
                '（推荐）在模组发布仓库提交 Issue（若使用 GitHub/GitLab，请使用发布页提供的 Issue 模板），此方式更公开透明且便于跟踪处理进度；',
                '或发送邮件至：nexusvai@139.com / nexusvai@foxmail.com（请在邮件主题注明"NexusV — 问题上报/数据请求"）；',
                '请勿通过邮件或 Issue 直接发送 API Key、密码、身份证号等敏感信息。',
                '开发者将在合理时间内（通常为 15 个工作日内）确认收到并在可行范围内处理或给出处理计划。若涉及法律问题，开发者保留将相关信息移交执法或权利人处理的权利。',
                '10.2 ChatAI 用户数据权利：依据《个人信息保护法》，ChatAI 服务用户就其个人信息享有以下权利，可通过上述联系方式申请行使：（1）知情权与决定权：有权了解开发者处理其个人信息的种类、目的、方式及保留期限；（2）查阅权：有权查阅开发者持有的其个人信息；（3）复制权：有权获取其个人信息的副本（以电子可读格式）；（4）更正权：有权要求更正不准确或不完整的个人信息；（5）删除权：在以下情形下有权要求删除个人信息：a) 处理目的已实现或不再需要；b) 用户撤回同意；c) 开发者违法处理；（6）撤回同意权：用户可随时撤回对特定处理活动的同意（撤回不影响撤回前基于同意的处理的合法性）；（7）可携带权：有权要求将个人信息转移至其指定的处理者（在技术可行的情形下）。开发者将在收到申请后 15 个工作日内予以处理，法律另有规定的除外。',
                '11. 终止',
                '11.1 因用户违约终止：若用户违反本协议之任一条款，开发者有权终止其对本套件相关闭源部分的使用许可，并要求其删除本套件全部副本；同时开发者可采取进一步的技术或法律措施维护合法权益。',
                '11.2 因版权方要求的终止：鉴于本套件依附于《Grand Theft Auto V》，若收到原版权方（Take-Two Interactive 或 Rockstar Games）的停止通知（Cease & Desist）或相关维权要求，开发者有权随时、无条件且不经提前通知地永久停止本套件的维护、下架相关文件并终止云端推理服务。在适用法律允许的最大范围内，除法律另有强制性规定外，开发者无需向用户承担违约或赔偿责任，但将尽量提前通知以便用户做好备份与过渡。',
                '11.3 ChatAI 服务终止与数据处理：开发者终止 ChatAI 服务时，将提前至少 30 日通过注册邮箱或 ChatAI 界面通知用户，并在服务终止前为用户提供导出对话历史的途径。服务终止后，开发者将依据第 4.6 节第（13）项所述数据保留期限处理用户数据，期限届满后予以删除。ChatAI 付费用户未到期的订阅，开发者将按剩余天数比例退还费用（如属激活码兑换，退还方式由双方协商）。',
                '11.4 本协议的终止不影响在终止前已产生之责任与义务。',
                '12. 适用法律与争议解决',
                '本协议的订立、效力、解释与争议解决，原则上适用中华人民共和国法律；但如用户所在地法律对消费者保护、个人信息保护或其他事项设有不得排除的强制性规定，则该等强制性规定优先适用。若用户所在司法区的强制性法律与本协议冲突，则以用户所在地的强制性法律为准。',
                '因本协议产生的争议，双方应首先友好协商；协商不成的，任何一方可向有管辖权的人民法院提起诉讼。',
                '13. 其他',
                '13.1 可分性：本协议各条款如因任何原因被有管辖权之法院判定为全部或部分无效，不影响其他条款的效力。',
                '13.2 完整协议：本协议构成您与开发者之间关于本套件之完整协议，取代此前任何口头或书面的协商与协议（但不影响对第三方组件原始许可的约束力）。如本协议与适用于特定开源组件、第三方库、模型权重或其他第三方内容的原始许可证发生冲突，就该特定内容而言，以其原始许可证及适用法律的强制性规定为准；本协议仅在不冲突的范围内补充适用。',
                '13.3 协议接受：本套件启动时显示的任何版本更新信息、公告或本协议的更新，对于已进行显著通知的重要变更，用户在相关版本首次启动时点击确认，或在知悉变更后继续使用相关版本的，视为接受更新后的协议。如本协议中英文版本存在歧义，以中文为准。',
                '13.4 儿童隐私：ChatAI 服务不面向未满 14 周岁的未成年人。开发者不会故意收集未满 14 周岁未成年人的个人信息。如监护人认为未成年人在未获监护人同意的情况下向开发者提供了个人信息，请联系开发者，开发者将在核实后及时删除相关信息。',
                '13.5 数据安全措施：开发者采用行业标准安全措施保护 ChatAI 服务中存储的用户数据，包括但不限于 HTTPS 加密传输、数据库访问控制、行级安全策略（RLS）等。但任何安全措施均无法提供绝对保证。如开发者发现可能影响用户个人信息安全的数据泄露事件，将依据《个人信息保护法》及时通知受影响用户，并向相关监管机构报告。',
                '13.6 公开透明与安全审计：Sentience 模块已开源，开发者邀请并鼓励用户及第三方机构对其网络请求行为、数据处理逻辑及代码实现进行安全审计。开发者致力于保持代码透明度，接受社区监督，以确保本套件的安全性与合规性。'
            ]
        },
        en: {
            title: 'NexusV Suite Terms of Use, Privacy Policy & Disclaimer',
            date: 'May 26, 2026',
            category: 'Company',
            paragraphs: [
                'Important Notice (Recommended to Read First)',
                'This Suite contains two distinct product types with fundamentally different data handling — please note each separately:',
                '[Game Mods (TACTFR / NexusV Modifier / Sentience)] use built-in SFT fine-tuned Qwen model by default (with one-click installer). Strongly recommend running locally — in default local inference mode, AI dialogue context is NOT sent to Developer-operated servers. If you choose cloud inference (DeepSeek, OpenAI, etc.), you must provide your own API Key (stored in local config.ini); all data transmission risks and costs are your responsibility.',
                '[ChatAI Service] is a cloud-based AI dialogue platform requiring email OTP login. Developer operates a cloud gateway and stores conversation history, usage records, device fingerprints, and other data (see Section 4.6). By using ChatAI Service you consent to the personal information processing practices described in this Agreement. If you do not consent, do not register or use ChatAI Service.',
                'Sentience core code is fully open source. Open Source Repository: https://github.com/NexusVAI/SENTIENCE',
                'Game mod components are for single-player entertainment only, strictly prohibited for illegal or commercial use.',
                'Using any component of this Suite means you have read and agreed to all terms of this Agreement.',
                '',
                'Last Updated: May 26, 2026',
                'This Agreement is effective as of May 26, 2026. Previous versions shall be governed by their original effective terms. This update primarily corrects the ChatAI Service privacy section (Section 4.6) to accurately reflect currently deployed data processing practices.',
                'This Terms of Use Agreement ("Agreement") primarily governs the license scope, usage restrictions, risk notifications, and liability boundaries of each module of the NexusV Suite; descriptions related to personal information and data flow apply to the currently provided functions of this Suite and do not constitute commitments to future unreleased cloud services.',
                '1. Definitions & Product Description',
                '1.1 "Suite" refers to the NexusV series content published by Developer, currently including: (1) TACTFR: A police gameplay enhancement mod for GTA V single-player offline environment; (2) NexusV Modifier: A numerical and experience adjustment tool for GTA V single-player offline environment; (3) Sentience: An AI mod for NPC dialogue generation and interaction enhancement within GTA V gameplay; (4) ChatAI: An AI aggregation dialogue service platform for users (hereinafter "ChatAI Service"), offering both free and paid tiers (Pro / Pro+ / Pro Max subscriptions and top-up credits).',
                '1.2 The current version of Sentience primarily provides AI dialogue generation functionality, supporting local model inference and third-party cloud model interfaces configured by users themselves. Unless otherwise explicitly stated in subsequent versions, the current version does not directly implement real-time control of NPC autonomous behavior, movement, combat, or task execution.',
                '1.3 This Suite is an unofficial third-party mod, with no authorization, recognition, cooperation, or co-branding relationship with Rockstar Games, Take-Two Interactive, or the original rights holders of Grand Theft Auto V. This Suite is provided solely for technical demonstration and entertainment purposes, and does not constitute an official extension or co-branded product of any of the aforementioned parties.',
                '1.4 This Suite adopts a hybrid licensing structure: Parts of Sentience source code explicitly released under MIT License are subject to MIT License; TACTFR and NexusV Modifier current versions and other clearly marked closed-source programs, resources, UI designs, installers, and configuration content within this Suite are subject to the restrictions set forth in this Agreement; third-party components, model weights, and related resources are subject to their respective original licenses.',
                '1.5 TACTFR, NexusV Modifier, and Sentience have relatively independent functional modules and risk boundaries, applicable to corresponding terms in this Agreement.',
                '1.6 ChatAI Service is entirely independent from the above game mod products (TACTFR, NexusV Modifier, Sentience) in technical architecture, product positioning, and target audience. ChatAI Service does not depend on any game environment, does not involve modification or injection of game files, and does not fall within the scope of game mods. As a generative AI dialogue platform, ChatAI Service is subject to the corresponding terms in this Agreement, including but not limited to Section 4.6 (ChatAI Privacy) and provisions related to generative AI in Section 5. With respect to ChatAI Service, Developer acts as cloud gateway operator and platform provider, bearing corresponding obligations as data processor and service provider under applicable laws.',
                '1.7 "Third-Party Components" means libraries, tools, or binaries from other authors/organizations embedded in or referenced by the Suite (see Section 3).',
                '1.8 "Personal Information" means any information recorded electronically or by other means that relates to an identified or identifiable natural person, excluding anonymized information.',
                '1.9 "Personal Information Processor" means an organization or individual that independently determines the purposes and means of processing personal information. Developer is the Personal Information Processor for personal information processed in connection with ChatAI Service.',
                '⚠️ Rockstar/GTA V Risk Independent Warning: Even in single-player offline mode, using any injection-based mod (including but not limited to TACTFR, NexusV Modifier, and Sentience modules in this Suite) still carries a very low probability risk of save file corruption, game abnormal operation, account anomaly, or ban due to Rockstar\'s future policy changes, anti-cheat detection mechanism updates, or game version iterations. To the maximum extent permitted by applicable law, except for damages caused by Developer\'s intentional acts or gross negligence, Developer assumes NO responsibility for the aforementioned risks. It is strongly recommended that before using this Suite: (1) Fully back up the entire GTA V game root directory and all save files; (2) Use only in completely offline single-player mode with network disconnected; (3) Avoid using on accounts associated with important game progress or paid content.',
                '2. License Grant',
                '2.1 Sentience source code parts explicitly released under MIT License are subject to MIT License text; this Agreement shall NOT be interpreted as diminishing users\' rights lawfully enjoyed under MIT License.',
                '2.2 TACTFR and NexusV Modifier Version Statement: Early historical versions of TACTFR and NexusV Modifier were once open source, and relevant old version codes continue to apply the open source licenses at that time. However, the latest versions of TACTFR and NexusV Modifier currently included in this Suite are in closed-source status. Their original code, UI design, and core logic retain all rights, licensed only for personal, non-commercial, single-player offline entertainment use.',
                '2.3 License Scope Boundary: This Suite adopts a tiered licensing architecture:\n(1) Sentience Module (Open Source Part): Independent source code (excluding model weights) is subject to MIT License, you may freely use/modify/distribute, but must comply with the original license of the model used;\n(2) Exclusive Closed-Source Part: The closed-source programs of TACTFR and NexusV Modifier currently included in this Suite, UI design, core logic, and preset configuration files — Developer grants user an irrevocable, personal, non-exclusive, non-transferable, non-sublicensable limited license, for personal, non-commercial, single-player offline entertainment use ONLY. Without prior written authorization from Developer, it is strictly prohibited to modify, reverse engineer, decompile, extract code, or redistribute the above closed-source binary files (including but not limited to repackaging for sale, paid installation services, or any other form of commercial monetization).\n(3) Sentience SFT Fine-tuned Model Weights: Provided under Qwen\'s original license agreement (see LICENSE in model folder and Qwen official license link: https://github.com/QwenLM/Qwen3.5/blob/main/LICENSE). Developer does NOT claim ownership of the base model, only shares the fine-tuned weight files. Distribution and use of this weight file are strictly subject to Apache 2.0 or Qwen License Agreement, your use constitutes acceptance of this license.\nThe above tiered licensing means: even if you compile the integrated package from source code and use it, without written authorization, you must still comply with this Agreement\'s restrictions on exclusive closed-source parts. Third-Party Component rights are subject to their original licenses and cannot be limited by this Agreement.\nException Clause: Developer allows and encourages users to share game recording and live streaming of using this Suite on video platforms (such as Bilibili, YouTube, Twitch, etc.) for free or with regular platform incentive-based content creation (including but not limited to platform ad revenue sharing, tips/donations, membership benefits, etc.). Such regular content creation and distribution is NOT considered "commercial monetization" prohibited by this Agreement, but creators must strictly comply with the "Deep Synthesis Identification" compliance requirements in Section 5 of this Agreement.',,
                'Third-Party Component rights are subject to their original licenses and cannot be limited by this Agreement.',
                '3. Third-Party Components & AI Models',
                '3.1 Game mod components: The Suite uses ScriptHookV (NOT included in package, please download from official website), ScriptHookVDotNet, NAudio, Newtonsoft.Json. The Suite only runs as a script patch, does NOT include, modify, or distribute any core binary files of the original game (GTA V) or any copyrighted game assets. Users bear full responsibility for any software conflicts or system instability caused by installing third-party injection tools such as ScriptHookV.',
                '3.2 Sentience default model: SFT fine-tuned Qwen series weights (such as Qwen2.5/Qwen3), subject to original model license (see LICENSE in model folder), using means you agree to that license.',
                '3.3 Game mod cloud mode requires user-provided: OpenAI API, DeepSeek API, etc., using means you agree to their Terms of Service and AUP. LM Studio is an optional local tool.',
                '3.4 ChatAI Service third-party components: ChatAI Service backend depends on: (1) Supabase (supabase.com): provides user authentication, database hosting and storage; data processing is governed by Supabase Privacy Policy (supabase.com/privacy); servers located in Singapore. (2) Cloudflare: Workers at chat.nexusvai.xyz host chat-gateway and api-gateway streaming inference, plus Turnstile login CAPTCHA; governed by Cloudflare Privacy Policy (cloudflare.com/privacypolicy). (3) Third-party AI model providers: provide actual inference services; see Section 4.6 item (9). Developer is not responsible for data processing by the above third parties.',
                '4. Privacy & Data Processing',
                '4.1 Default Local Mode (Strongly Recommended): Sentience uses built-in SFT fine-tuned Qwen model, all inference runs on your PC locally, does NOT send any game data or player input to any third party. Developer does not collect any personal data.',
                '4.2 Cloud API Mode (Requires User Initiative): After you enter your own API Key in local config.ini, the Suite sends NPC dialogue context directly to your designated service provider. Developer does NOT intercept, store, or view your API Key or dialogue content. API Key is stored in plain text in locally accessible config file, do NOT share this file or upload to public repositories, strongly recommend using local mode to avoid data transmission and cost risks. When using cloud mode, your IP address and device info will be sent directly to your chosen API service provider by your PC, governed by their privacy policy.',
                '4.3 Data Minimization: Only sends necessary context, will NOT intentionally send real name, ID number, payment info or other sensitive personal information. Users should avoid inputting highly sensitive personal information such as real name, ID number, address, phone number, payment info, etc. in conversations with Sentience; any consequences arising from user\'s voluntary input (including but not limited to information leakage, model memorization, legal risks, etc.) shall be borne by the user.',
                '4.4 Data Processing Role Definition: This Suite is essentially a locally running client tool software. Developer has NOT established, nor operates any cloud server for processing mod data. Therefore, Developer is NOT a personal information processor under the Personal Information Protection Law (PIPL). When you use local models, data does NOT leave your local device; when using cloud APIs, data is transmitted directly from your local device to third-party service providers (such as OpenAI, DeepSeek) end-to-end. If subsequent versions of this Suite provide Developer-operated cloud services, a separate Privacy Policy will be published and users will be required to check and agree before use. This Agreement does not cover such services not currently provided. Local logs on your PC can be deleted by yourself.',
                '4.5 Deployed Cloud Services Notice: ChatAI Service has deployed Developer-operated cloud inference gateway (chat-gateway), account system (based on Supabase Auth, using email OTP login), and paid subscription system (Pro / Pro+ / Pro Max monthly subscriptions + top-up credits). Specific data processing practices for these services are detailed in Section 4.6. Users may delete local logs on their own devices.',
                '4.6 ChatAI Service Privacy: ChatAI Service uses a cloud processing architecture. User conversation requests are forwarded through Developer-operated cloud gateway (chat-gateway) to third-party AI models for inference, with results returned to the user interface via the gateway. Specific data processing practices: (1) Conversation content storage: User conversation history generated through ChatAI Service is stored in Developer-operated cloud database (Supabase), including conversation titles, message content, and model used. Conversation history is associated with user accounts to support cross-device sync, conversation continuation, and history review. Developer does not use user conversation content for training AI models. Users can proactively delete conversation history in the ChatAI interface; once deleted, Developer no longer retains such data. (2) Usage records: Developer records usage details for each AI model call (including user ID, model ID, input/output token counts, call time, and whether the call succeeded), used for quota management, usage statistics, and billing settlement. Usage records do not contain original conversation content. (3) Account and identity information: Using ChatAI Service requires email OTP login (based on Supabase Auth). Developer obtains and stores user registration email addresses. During paid order processing, Developer obtains and stores user-submitted email and QQ number for order review and activation code delivery. Developer does not require phone numbers, real names, or ID numbers. (4) Device fingerprinting and anti-abuse: To prevent multi-account abuse and ensure service fairness, Developer collects device/browser fingerprint information after user login (including but not limited to Canvas/WebGL/Audio fingerprints, WebRTC IP, User-Agent, screen resolution, timezone, language, hardware parameters, etc.), generates a composite visitor_id stored server-side for cross-account association detection. Developer also records user IP addresses and caches geolocation information for security auditing and anti-abuse. (5) Error telemetry: With user consent, ChatAI Service collects uncaught browser exception information (including UA, current URL, viewport dimensions, exception message and stack, URLs and status codes of the last 10 fetch requests) for troubleshooting and product improvement. Users may decline telemetry without affecting normal usage. (6) User memory feature: ChatAI Service provides an optional user memory feature, allowing users to set personalized preference information (up to 5 entries per user, each no more than 100 characters), stored in the cloud database to provide context for AI in subsequent conversations. Users may disable or delete memory content at any time. (7) Arena: ChatAI Service provides a model comparison arena feature. User-submitted prompts and model responses are stored server-side for vote tallying and model evaluation. Arena data is associated with user accounts. (8) Encrypted transmission: All data transmission between users and ChatAI Service is completed through HTTPS encrypted channels. (9) Third-party models: AI models aggregated by ChatAI are provided by third parties; Developer forwards user conversation requests to third-party model service providers via cloud gateway for inference. User conversation content is processed by third-party model service provider servers during inference, governed by their respective privacy policies and terms of service. Developer does not assume responsibility for third-party data processing practices; users should independently understand and agree to relevant third-party terms. (10) Paid system: ChatAI Service offers Pro / Pro+ / Pro Max monthly subscriptions and top-up credit purchases. Subscription status, monthly quota consumption, top-up credit balance, and usage ledger are stored server-side for billing and entitlement management. Payment is processed via manual order review + activation code redemption; Developer does not directly process payment information. (11) Bans and appeals: If users violate this Agreement or are detected as abusers by the system, Developer reserves the right to ban accounts. Banned users may submit appeal requests through the appeal process; appeal information is stored server-side. (12) Sensitive information: Users should not input real names, ID numbers, bank card information, addresses, phone numbers, payment credentials, passwords, or other highly sensitive information in ChatAI conversations; consequences arising from voluntarily inputting sensitive information shall be borne by the user.',
                '(13) Data retention: Conversation history is retained until proactively deleted by the user; once deleted, Developer will remove it from production databases within 30 days and purge backup copies within 90 days. Usage records are retained for 12 months after the corresponding subscription period ends, for billing reconciliation and dispute resolution. Device fingerprint data is retained for 180 days after the user\'s last login. Ban and appeal records are retained for 12 months after the ban is lifted. Longer retention periods required by applicable law shall prevail.',
                '(14) Cross-border transfer: ChatAI Service backend database is hosted on Supabase with servers in Singapore. User data transmitted to Singapore is protected by HTTPS encryption. Developer has assessed the necessity of such cross-border transfers and confirmed that Supabase\'s data security measures meet applicable legal requirements.',
                '(15) Cookies and local storage: ChatAI Service uses the following local storage in your browser: (a) Supabase Auth session token (localStorage key: cancri_supabase_auth), to maintain login state; (b) Anonymous identifier (localStorage key: cancri_anon_id), for telemetry and fingerprint association; (c) Telemetry consent status (localStorage key: cancri_telemetry_consent); (d) User preferences (localStorage keys: theme, lang, etc.). ChatAI Service does NOT use tracking cookies. You may clear this local data via browser settings at any time.',
                '5. AI-Generated Content & User Responsibility',
                '5.1 Game Mod (Sentience) Tool Attribute: This Suite (Sentience module) only provides local model runtime environment and cloud API calling interface. Developer is NOT a "Generative AI Service Provider" for the game mod components. When using this Suite to generate content, users should comply with relevant laws and regulations of their country/region on their own (including but not limited to Provisions on the Management of Deep Synthesis of Internet Information Services, etc.).',
                '5.2 ChatAI Service Generative AI Compliance: ChatAI Service output is automatically generated by third-party AI models based on user input. Developer operates the cloud gateway for request forwarding, quota management, and usage recording, but does not participate in the actual AI inference process, having no copyright or editorial control over any specific output. Developer fulfills the following obligations: (1) Content labeling: AI-generated content in the ChatAI interface is clearly marked to distinguish it from human-authored content; (2) Reporting mechanism: Users may report illegal or inappropriate AI outputs through the ChatAI interface or via Section 10 contact methods; Developer will process within a reasonable time; (3) User-generated content management: Users must independently judge the legality, accuracy, and applicability of content generated through ChatAI, and bear legal consequences arising from such use. Users shall not use ChatAI to generate content that violates local laws, including but not limited to false information, infringing content, or illegal harmful content. Developer reserves the right to apply content filtering, restrict, or terminate user access to ChatAI upon discovering illegal or violating usage.',
                '5.3 Independence of AI Outputs: All dialogues, storylines, opinions generated by the Suite are produced in real-time by the model used, representing only model outputs, not positions or statements of Developer or any third party.',
                '5.4 Unpredictability: Model outputs are uncertain and may contain errors, fictional, offensive, or inappropriate content. Any advice generated by the model regarding medical, legal, investment, or other professional fields is purely fictional and shall not be treated as real-world reference.',
                '5.5 Deep Synthesis Identification: NPC dialogues generated by Sentience are AI-synthesized content. When sharing related videos, you must clearly mark "This video contains AI-generated dialogue/fictional content" in the description or a prominent position; you shall not use game recordings/dialogues to impersonate real persons, impersonate officials, or use in news or government affairs scenarios that may mislead the public.',
                '5.6 TACTFR police/suspect AI is for game entertainment simulation only, must NOT be used for real law enforcement training or impersonating real agencies.',
                '5.7 Prohibited Uses: It is strictly prohibited to use this Suite to generate and publicly disseminate on the internet any content that violates local laws and regulations, including but not limited to pornography, violent terrorism, hate speech, privacy infringement, or defamation.',
                '6. Usage Restrictions',
                '6.1 Age Restriction: This Suite is for adults only. If the laws of your jurisdiction require a higher age for similar content or game mods, those requirements apply. You must confirm compliance before first use; if you are under 18 or lack full civil capacity, stop using and delete this Suite immediately. ChatAI Service does not provide personal information processing services to users under 14 years of age; if Developer discovers a user is under 14, it will notify the guardian and seek ratification, or delete the personal information.',
                '6.2 Game Mod Online Restriction: STRICTLY PROHIBITED from using any part of this Suite in GTA Online or any Rockstar official multiplayer service. Any resulting account bans are your sole responsibility. Export Control: When using cloud API mode, ensure your network environment and calling behavior comply with applicable export control laws. Developer assumes no joint liability for bans or legal repercussions caused by non-compliant API calls.',
                '6.3 Commercial Monetization Prohibition: The Suite shall not be used for any illegal purpose or commercial monetization in any form unless prior written authorization is obtained from Developer.',
                '6.4 Reverse Engineering Restriction: Unless permitted by original licenses of third-party components, you shall not reverse engineer, decompile, or disassemble the proprietary parts of Developer (except Sentience under MIT License).',
                '6.5 Game Mod Offline Recommendation: Recommended to use in single-player/offline mode to reduce risk of bans; Developer does not guarantee safety in online multiplayer mode.',
                '6.6 ChatAI Service Usage Restrictions: (1) Account sharing prohibited: Each ChatAI account is for personal use only; do not share credentials with third parties. Developer may detect and handle shared accounts. (2) Quota abuse prohibited: Do not circumvent free quota limits or paid subscription caps via multi-account registration, fingerprint spoofing, automated scripts, or other technical means. (3) Automated access prohibited: Do not use bots, scrapers, or unauthorized automated scripts to bulk-access ChatAI Service APIs. (4) Service abuse prohibited: Do not engage in behavior that damages service stability, fairness, or other users\' experience.',
                '7. Disclaimer of Warranties & Limitation of Liability',
                '7.1 Provided "As Is": The Suite is provided "AS IS"; Developer makes no express or implied warranties including but not limited to merchantability, fitness for a particular purpose, non-infringement, or defect-free.',
                '7.2 No Guarantee of Availability: Developer does not guarantee the Suite will continue uninterrupted, secure, error-free, or fully meet expectations; nor does it guarantee the availability or stability of any third-party services or models.',
                '7.3 Risk Self-Assumed: To the maximum extent permitted by applicable law, except for damages caused by Developer\'s intentional acts or gross negligence, Developer shall not be liable for indirect, incidental, consequential, or profit losses, account risks (including bans), save corruption, or unavailability of third-party services arising from downloading, installing, or using the Suite.',
                '7.4 Unofficial Channel Risk: This Suite is only released for free on Developer-specified official channels. Developer assumes no responsibility for losses, malware infections, or data breaches from Suite obtained through unauthorized channels.',
                '7.5 Limitation of Liability: To the maximum extent permitted by applicable law, except for damages caused by Developer\'s intentional acts or gross negligence, Developer shall not be liable for any indirect, special, punitive, or consequential damages. For ChatAI paid users, maximum liability for direct damages attributable to Developer is limited to subscription fees actually paid by the user to Developer in the prior 12 months; for free users, maximum liability shall not exceed RMB 100 or the statutory minimum compensation, whichever is higher.',
                '7.6 ChatAI Paid Subscription Refund Policy: ChatAI subscriptions are activated via activation codes and take effect immediately; unused remaining quota is non-refundable as cash. If service experiences a serious defect attributable to Developer (single continuous outage exceeding 72 hours without compensation), users may request pro-rated compensation. Top-up credits once activated and consumed are non-refundable; if completely unused, users may request a refund within 7 days of activation. Statutory consumer rights are not limited by this policy.',
                '7.7 Installer & Security Software: The one-click installer may be flagged by antivirus software (e.g., Windows Defender). This is common for unsigned game patches. Users must judge and decide whether to trust. Developer assumes NO responsibility for game failure or file damage caused by installer or antivirus interference. Back up your GTA V root directory before use.',
                '7.8 API Key Security: API Key is stored in plain text in local config.ini. Do NOT share this file or configure cloud API on public/shared devices. Developer will not collect your Key, but cannot prevent you from self-leaking. Any charges or losses from leakage are your full responsibility.',
                '7.9 This limitation of liability is not intended to circumvent statutory non-excludable liability for intentional or gross negligence.',
                '7.10 User Indemnification: You agree to indemnify Developer for any third-party claims, administrative penalties, lawsuits, or economic losses (including reasonable attorney fees) caused by your violation of this Agreement.',
                '8. Maintenance, Updates & Agreement Changes',
                '8.1 Developer may update, maintain, or change Suite functions from time to time. For modifications to this Agreement, Developer will publish change descriptions on the Mod release page/repository and mark the effective date. For material changes affecting user rights and obligations, Developer will provide prominent notice via release page announcement, update log, or first-launch prompt. Continued use after changes take effect constitutes acceptance of the updated Agreement.',
                '8.2 For material changes to ChatAI Service personal information processing practices (including adding new data types, changing purposes, or changing cross-border transfer destinations), Developer will separately notify users via ChatAI interface popup or registered email, and will only continue processing after users re-confirm consent; if users do not consent, they may stop using ChatAI Service and request deletion of their personal information.',
                '8.3 If you do not agree to any changes, stop using and delete the Suite.',
                '9. Intellectual Property',
                '9.1 Sentience source code copyright belongs to Developer, its use is subject to MIT License, you may freely copy, modify, distribute under MIT terms.',
                '9.2 Intellectual Property of Closed-Source Components: The current versions of TACTFR and NexusV Modifier included in this Suite are closed-source works of Developer. All software copyrights and related intellectual property rights belong to Developer. Any license agreement for historical open source versions does NOT apply to the current closed-source version included in this Suite. Without prior written permission from Developer, no one may modify, crack, or redistribute the closed-source components of this Suite.',
                '9.3 Third-party rights: The intellectual property rights of third-party trademarks, game assets, and brands cited in the Suite belong to the original rights holders, and users shall not claim any ownership or imply official authorization.',
                '10. Complaints, Feedback & Contact Information',
                '10.1 Contact Channels: If you discover security issues, illegal or seriously inappropriate AI outputs, or need to exercise data subject rights (see Section 10.2), please contact Developer via:',
                '(Recommended) Submit an Issue on the Mod release repository (if using GitHub/GitLab, use the issue template on the release page) — this is more transparent and trackable;',
                'Or email: nexusvai@139.com / nexusvai@foxmail.com (subject: "NexusV — Issue Report/Data Request");',
                'Do NOT send API Keys, passwords, ID numbers or other sensitive information via email or Issue.',
                'Developer will confirm receipt within a reasonable time (typically within 15 business days) and handle or provide a plan within feasible scope. If legal issues are involved, Developer reserves the right to transfer information to law enforcement or rights holders.',
                '10.2 ChatAI User Data Rights: ChatAI Service users have the following rights regarding their personal information, exercisable via the above contact methods: (1) Right to know and decide; (2) Right of access; (3) Right to copy (in electronic readable format); (4) Right to correction; (5) Right to erasure: when processing purpose is achieved, consent is withdrawn, or Developer processes unlawfully; (6) Right to withdraw consent (without affecting lawfulness of prior processing); (7) Right to data portability (where technically feasible). Developer will respond within 15 business days of receiving a request.',
                '11. Termination',
                '11.1 Termination for User Breach: If a user violates any terms of this Agreement, Developer has the right to terminate the user\'s license to use the closed-source components of the Suite and request deletion of all copies; Developer may also take further technical or legal measures.',
                '11.2 Termination Due to Copyright Holder Requests: If Developer receives a Cease & Desist notice from Take-Two Interactive or Rockstar Games, Developer has the right to permanently cease maintenance, remove files, and terminate cloud services at any time, unconditionally, and without prior notice, without liability to users except as required by mandatory law.',
                '11.3 ChatAI Service Termination and Data Handling: When terminating ChatAI Service, Developer will notify users at least 30 days in advance via registered email or ChatAI interface, and provide a means to export conversation history before termination. After termination, Developer will process user data per the retention periods in Section 4.6 item (13) and delete after expiry. Paid users with unexpired subscriptions will receive pro-rated refunds (for activation code subscriptions, refund method to be negotiated).',
                '11.4 Termination of this Agreement does not affect liabilities and obligations that have arisen before termination.',
                '12. Governing Law & Dispute Resolution',
                '12.1 Governing Law: The establishment, execution, and interpretation of this Agreement shall be governed by the laws of the People\'s Republic of China; however, if the mandatory laws of the user\'s judicial district conflict with this Agreement, the mandatory laws of the user\'s location shall prevail.',
                '12.2 Dispute Resolution: For disputes arising from this Agreement, both parties should first negotiate in good faith; if negotiation fails, either party may file a lawsuit with the people\'s court with jurisdiction where the Developer is located.',
                '13. Miscellaneous',
                '13.1 Severability: If any terms of this Agreement are ruled wholly or partially invalid by a court with jurisdiction, it does not affect the validity of other terms.',
                '13.2 Entire Agreement: This Agreement constitutes the complete agreement between you and Developer regarding the Suite, superseding any prior negotiations and agreements (but not affecting the binding force of original licenses of third-party components).',
                '13.3 Acceptance: Any version update information, announcements, or Agreement updates displayed when the Suite starts — for material changes with prominent notice, your clicking confirm on first launch or continued use after becoming aware constitutes acceptance. In case of any discrepancy between the Chinese and English versions, the Chinese version shall prevail.',
                '13.4 Children\'s Privacy: ChatAI Service is not directed to users under 14 years of age. Developer does NOT knowingly collect personal information from users under 14. If a guardian believes a minor has provided personal information without consent, please contact Developer for prompt deletion after verification.',
                '13.5 Data Security Measures: Developer uses industry-standard security measures to protect user data in ChatAI Service, including HTTPS encrypted transmission, database access controls, and row-level security (RLS) policies. No security measures can provide absolute guarantees. In the event of a data breach that may affect user personal information security, Developer will notify affected users and report to relevant regulatory authorities as required by applicable law.',
                '13.6 Transparency & Security Audit: Sentience module is open source. Developer invites and encourages users and third parties to audit its network request behavior, data processing logic, and code implementation. Developer is committed to code transparency and community oversight to ensure the security and compliance of this Suite.'
            ]
        }
    },
    news4: {
        media: { type: 'image', src: 'Logo/updated_team-1.webp', alt: '玩家动力' },
        zh: {
            title: '模组登陆玩家动力',
            date: '2025年12月30日',
            category: '公司',
            paragraphs: [
                'NexusV 模组现已正式登陆玩家动力平台，为数百万玩家带来全新的互动体验。',
                '此次发布标志着我们在游戏生态领域的进一步拓展。'
            ]
        },
        en: {
            title: 'Mod Lands on WanJiaDongLi',
            date: 'December 30, 2025',
            category: 'Company',
            paragraphs: [
                'The NexusV mod has now officially landed on the WanJiaDongLi platform, bringing a brand new interactive experience to millions of players.',
                'This release marks our further expansion in the field of game ecology.'
            ]
        }
    },
    news5: {
        media: { type: 'image', src: 'Logo/enterprise.webp', alt: '安全' },
        zh: {
            title: '我们确保每一次使用都是安全的',
            date: '2026年2月13日',
            category: '安全',
            paragraphs: [
                '当前，游戏模组生态正经历一场由大模型驱动的革命。玩家与开发者不再满足于简单的脚本替换，而是渴望拥有具备逻辑推理、动态交互能力的"智能 NPC"与"自动化辅助"。然而，这一需求的爆发与现有的云端 API 模式存在着根本性的矛盾：高延迟、隐私泄露风险、以及昂贵的 Token 成本，成为了阻碍 AI 在游戏本地环境落地的三座大山。',
                '为了推倒这三座大山，并普及真正"即装即用"的本地 AI 体验，底层算力优化、显存压缩技术与精准的模型裁剪缺一不可。',
                '今日，我们宣布完成核心技术架构的重大突破，并获得国内社区的支持与推广。我们已成功打通从模型部署到本地推理的全链路，彻底摒弃了 2023 年那种需要调用 API Key 的"伪本地"模式。在 GTA5 的复杂渲染环境下，我们实现了纯离线的端侧推理。',
                '通过全栈本地化的架构，我们将"安全"与"性能"做到了极致。这种优势已在我们的内测版本中得到验证：',
                '物理级的数据隔离（Zero Data Leakage）：不同于市面上那些"本地运行但需联网验证"的方案，我们的引擎完全运行在用户的 GPU 显存中。这意味着，无论是你在游戏中的自定义任务脚本、独特的载具改装参数，还是包含个人隐私的语音指令，其数据生命周期始终锁死在本地硬盘与显卡之间。0% 的数据上传率，不仅是安全承诺，更是防止 R 星反作弊系统误判的核心保障。',
                '极致的显存优化与低延迟：针对 GTA5 高负载的特点，我们自研了压缩算法。甚至在 GT730 等亮机显卡上，我们将 3B 参数模型的显存占用降低了 24%，同时保持了每秒 20+ Token 的生成速度。这意味着，当你在洛圣都飙车时，AI 助手的响应速度与游戏帧率同步，彻底告别了"等 AI 说话就卡顿"的糟糕体验。',
                '离线环境下的高可用性：摆脱了对外部 API 接口的依赖，意味着彻底免疫了因 OpenAI 服务器宕机、网络波动或 API Key 余额不足导致的"智能断连"。在我们的评估中，本地部署版本可在断网 72 小时的极端环境下，可以保持 99.9% 的指令执行成功率，确保了模组体验的连续性。',
                '精准的模组场景适配：目前，我们的核心测试群已覆盖 150+ 名硬核 GTA5 模组玩家与脚本开发者。我们正步入一个新阶段：AI 正在从"云端的神"变成"本地的工具"。对于游戏模组而言，未来的竞争力不取决于谁调用的模型更大，而取决于谁能在有限的本地算力下，跑出更安全、更懂游戏逻辑的小模型。本轮技术升级将助力我们扎根于 GTA5 乃至更多开放世界游戏的生态，解决"想用 AI 但怕封号、怕延迟"的真实痛点。',
                '我们的使命很简单：让每一位玩家和 Modder 都能在自己的电脑上，安全、自由地运行最顶尖的 AI。不需要联网，不需要 Key，只需要一张显卡和我们的代码。'
            ]
        },
        en: {
            title: 'Ensuring Safety in Every Use',
            date: 'February 13, 2026',
            category: 'Safety',
            paragraphs: [
                'Currently, the game mod ecosystem is undergoing a revolution driven by large models. Players and developers are no longer satisfied with simple script replacements but crave "intelligent NPCs" and "automated assistance" with logical reasoning and dynamic interaction capabilities. However, the explosion of this demand fundamentally contradicts the existing cloud API model: high latency, privacy leakage risks, and expensive Token costs have become the three major mountains hindering the implementation of AI in local game environments.',
                'In order to push down these three mountains and popularize a truly "ready-to-use" local AI experience, underlying computing power optimization, video memory compression technology, and precise model pruning are indispensable.',
                'Today, we announce the completion of a major breakthrough in the core technical architecture and have received support and promotion from the domestic community. We have successfully opened up the entire link from model deployment to local inference, completely abandoning the "pseudo-local" mode of 2023 that required calling API Keys. In the complex rendering environment of GTA5, we have achieved pure offline edge inference.',
                'Through the full-stack localized architecture, we have taken "security" and "performance" to the extreme. This advantage has been verified in our internal beta version:',
                'Physical-level Data Isolation (Zero Data Leakage): Unlike those "run locally but require online verification" solutions on the market, our engine runs entirely in the user\'s GPU video memory. This means that whether it is your custom mission script in the game, unique vehicle modification parameters, or voice commands containing personal privacy, its data lifecycle is always locked between the local hard drive and the graphics card. A 0% data upload rate is not only a safety promise but also a core guarantee to prevent false positives from the Rockstar anti-cheat system.',
                'Extreme Video Memory Optimization and Low Latency: Aiming at the high load characteristics of GTA5, we developed our own compression algorithm. Even on entry-level graphics cards like the GT730, we reduced the video memory usage of the 3B parameter model by 24% while maintaining a generation speed of 20+ Tokens per second. This means that when you are racing in Los Santos, the response speed of the AI assistant is synchronized with the game frame rate, completely saying goodbye to the terrible experience of "stuttering waiting for AI to speak".',
                'High Availability in Offline Environments: Getting rid of dependence on external API interfaces means complete immunity to "intelligent disconnection" caused by OpenAI server downtime, network fluctuations, or insufficient API Key balances. In our assessment, the locally deployed version can maintain a 99.9% instruction execution success rate in an extreme environment of 72 hours of disconnection, ensuring the continuity of the mod experience.',
                'Precise Mod Scene Adaptation: Currently, our core test group has covered 150+ hardcore GTA5 mod players and script developers. We are entering a new stage: AI is changing from a "god in the cloud" to a "local tool". For game mods, future competitiveness does not depend on who calls the larger model, but on who can run a safer, smaller model that understands game logic better under limited local computing power. This round of technical upgrades will help us take root in the ecology of GTA5 and even more open-world games, solving the real pain points of "wanting to use AI but afraid of bans and latency".',
                'Our mission is simple: to allow every player and Modder to run the top AI safely and freely on their own computer. No internet required, no Key required, just a graphics card and our code.'
            ]
        }
    },
    news6: {
        media: { type: 'image', src: 'Logo/ChatGPT_Charts_Blog_Hero.webp', alt: 'Sentience-V3.1' },
        zh: {
            title: '了解 Sentience V3.1',
            date: '2026年3月02日',
            category: '产品',
            readTime: '10 分钟阅读',
            paragraphs: [
                '由 某宇 带领的 NexusV 团队很高兴宣布 Sentience v3.1 正式发布 —— 这是为《侠盗猎车手 V》（Grand Theft Auto V）等开放世界环境打造的下一代 AI-NPC 引擎中的一次关键迭代。我们把工程级的可靠性、可配置性与延迟优化放在首位，让沉浸式 NPC 体验在真实游戏环境中更易部署、调试与管控，同时保留了你熟悉的"觉醒"与情绪驱动交互能力（详见更新日志概览）。',
                '我们要解决的问题',
                '玩家与 mod 开发者常常面对三类挑战：模型接入复杂、第一次对话延迟高、以及运行时参数难以微调。v3.1 的设计目标，就是把这些痛点变成可控项 —— 通过统一的配置、可切换的推理后端，以及更鲁棒的 TTS 管线，让 AI 驱动的 NPC 在质量与可维护性间取得平衡。',
                '核心亮点（面向工程团队）',
                '配置文件系统（ModConfig）：新增基于 INI 的配置管理（首次运行自动生成 Documents/GTA5MOD2026/config.ini），支持细粒度项：[LLM]（Provider、Endpoint、Model、APIKey）、[Performance]（MaxTokens、Temperature）、[TTS]、[Awakening] 等，所有运行参数可在不重编译的情况下在线调优。',
                'AI 管理器（AIManager）更新：从 ModConfig 读取设置，支持云端 API（如 DeepSeek / OpenAI）并自动处理 Authorization 头，也支持本地推理（LM Studio），并实现基于配置的智能对话截断（MaxDialogueLength），以控制上下文体积与 token 成本。',
                'TTS 管线重构（VoiceManager）：全新实现，支持 ModConfig 配置；引入 Python edge-tts 进程预热（消除首次对话延迟）、TTS 服务器优先 + CLI 回退机制，并由 NAudio 取代 PowerShell 播放音频，显著降低延迟；同时动态调整 SSML 参数（语速、音调），根据情绪（Angry、Scared、Happy 等）呈现更自然的语音表现。',
                'NPC 管理器集成（NPCManager）：在交互发送流程中使用配置的 MaxTokens 与 Temperature，并将 AwakenSystem 的觉醒上下文注入对话流，确保行为上下文一致且可控。',
                '（以上核心变更与实现细节源自 v3.1 更新日志。）',
                '为什么这很重要',
                '更低的运维成本：集中式配置减少了为每个测试场景重编译或修改代码的需要，调参变成编辑 .ini 的小步流程。',
                '更稳定的用户体验：TTS 预热与 NAudio 播放链路显著降低首次播放与中断感知，使 NPC 语音对话更像"活着"的角色而非技术堆栈的产物。',
                '灵活的推理部署：本地模型（LM Studio）与云端 API 的双通路支持，允许你在隐私、延迟与成本之间做出权衡：想要本地隐私优先？开本地模型；想要更大模型能力？接云端。',
                '可控的上下文窗口：通过 MaxDialogueLength 等参数，你可以在对话质量与 token 花费之间精确取舍，适配从长剧情到战斗即时响应的不同场景。',
                '面向开发者的实用指南（快速上手）',
                '升级到 v3.1（覆盖安装或替换主文件）。',
                '启动游戏一次以生成默认配置文件：Documents/GTA5MOD2026/config.ini。',
                '编辑 [LLM] 与 [Performance]：根据是否使用本地 LM Studio 或云端 API 填入对应 Provider/Endpoint/APIKey。',
                '若对语音表现有高要求，启用 PreWarmEdgeTTS 并选择 TTS 优先级（TTS Server > CLI）。',
                '使用 MaxDialogueLength 控制上下文体积；在高并发或多人场景中可适当减少以降低延迟。',
                '（详尽字段说明已写入随附文档与 README，欢迎查阅。）',
                '安全、隐私与治理（工程级考量）',
                'v3.1 明确将数据流交由可配置后端：当你配置云端 API 时，对话上下文会被发送至所选服务提供方进行推理；若你启用本地 LM，则所有推理与日志都限定于本机进程。强烈建议：',
                '在多人/联机场景关闭联网推理以降低被官方服务检测/封禁的风险；',
                '对生产/公开演示场景启用内容过滤与上报机制；',
                '对外连服务使用独立 API Key，并在配置中限定最小权限与最短日志保留周期。',
                '与以往版本的关系',
                'v3.1 在稳定性与可配置性上是对 v3.0（引入语音输入、互动菜单、全 NPC 覆盖与自动反应）的一次工程化升级；同时继承 v2.0 的记忆系统与情感 TTS 能力。若你从 v1.x 或 v2.x 升级，流程为无缝迁移：原有记忆与 NPC 数据兼容，配置文件将在首次运行时自动生成并尝试保留旧设置。',
                '我们对外的承诺',
                '我们致力于把 NexusV 打造为一流的 AI-NPC 基础设施：稳定、可配置、可审计。v3.1 的发布是一小步工程演进，但对 mod 制作者和技术演示者来说，是一大步工具化进展 —— 把复杂的模型接入与低延迟语音交付变成可重复、可调优的工程流程。',
                '获取支持与反馈',
                '如在升级或使用过程中遇到问题、发现内容风险或需要企业级部署建议，请通过邮箱联系我们：nexusv@139.com。我们会在合理时间内回复并协助定位问题。',
                '感谢社区、测试者与反馈者。接下来我们会把配置文档、示例 config.ini 模板与 TTS 调优指南同步到发布页，方便大家快速上手与复现。欢迎把你的实验与场景分享到仓库 issue，让我们一起把开放世界的虚拟生命做得更真实、更可信。',
                '— NexusV 团队'
            ]
        },
        en: {
            title: 'Learn About Sentience V3.1',
            date: 'March 02, 2026',
            category: 'Product',
            readTime: '10 min read',
            paragraphs: [
                'The NexusV team, led by 某宇，is pleased to announce the official release of Sentience v3.1 — a critical iteration in the next-generation AI-NPC engine designed for open-world environments such as Grand Theft Auto V. We prioritize engineering-grade reliability, configurability, and latency optimization, making immersive NPC experiences easier to deploy, debug, and manage in real game environments, while retaining the familiar "awakening" and emotion-driven interaction capabilities (see the changelog overview for details).',
                'Problems We Aim to Solve',
                'Players and mod developers often face three types of challenges: complex model integration, high latency for the first conversation, and difficulty in fine-tuning runtime parameters. The design goal of v3.1 is to turn these pain points into controllable items — through unified configuration, switchable inference backends, and a more robust TTS pipeline, allowing AI-driven NPCs to achieve a balance between quality and maintainability.',
                'Core Highlights (For Engineering Teams)',
                'Configuration File System (ModConfig): New INI-based configuration management (automatically generates Documents/GTA5MOD2026/config.ini on first run), supporting granular items: [LLM] (Provider, Endpoint, Model, APIKey), [Performance] (MaxTokens, Temperature), [TTS], [Awakening], etc. All runtime parameters can be tuned online without recompiling.',
                'AI Manager (AIManager) Update: Reads settings from ModConfig, supports cloud APIs (such as DeepSeek / OpenAI) and automatically handles Authorization headers, also supports local inference (LM Studio), and implements configuration-based intelligent dialogue truncation (MaxDialogueLength) to control context volume and token costs.',
                'TTS Pipeline Refactoring (VoiceManager): Completely re-implemented, supporting ModConfig configuration; introduces Python edge-tts process preheating (eliminating first conversation latency), TTS server priority + CLI fallback mechanism, and replaces PowerShell audio playback with NAudio, significantly reducing latency; simultaneously dynamically adjusts SSML parameters (speech rate, pitch) to present more natural speech performance based on emotions (Angry, Scared, Happy, etc.).',
                'NPC Manager Integration (NPCManager): Uses configured MaxTokens and Temperature in the interaction sending process, and injects AwakenSystem\'s awakening context into the dialogue flow to ensure behavioral context is consistent and controllable.',
                '(The above core changes and implementation details are from the v3.1 changelog.)',
                'Why This Matters',
                'Lower Operational Costs: Centralized configuration reduces the need to recompile or modify code for each test scenario. Tuning parameters becomes a small-step process of editing .ini files.',
                'More Stable User Experience: TTS preheating and NAudio playback links significantly reduce first playback and interruption perception, making NPC voice conversations more like "living" characters rather than products of a technology stack.',
                'Flexible Inference Deployment: Dual-path support for local models (LM Studio) and cloud APIs allows you to make trade-offs between privacy, latency, and cost: Want local privacy first? Use local models; Want larger model capabilities? Connect to the cloud.',
                'Controllable Context Window: Through parameters like MaxDialogueLength, you can make precise trade-offs between dialogue quality and token costs, adapting to different scenarios from long storylines to combat instant responses.',
                'Practical Guide for Developers (Quick Start)',
                'Upgrade to v3.1 (overwrite installation or replace main files).',
                'Launch the game once to generate the default configuration file: Documents/GTA5MOD2026/config.ini.',
                'Edit [LLM] and [Performance]: Fill in the corresponding Provider/Endpoint/APIKey based on whether you are using local LM Studio or cloud API.',
                'If you have high requirements for speech performance, enable PreWarmEdgeTTS and select TTS priority (TTS Server > CLI).',
                'Use MaxDialogueLength to control context volume; in high-concurrency or multiplayer scenarios, it can be appropriately reduced to lower latency.',
                '(Detailed field descriptions have been written into the accompanying documentation and README, welcome to review.)',
                'Security, Privacy & Governance (Engineering Considerations)',
                'v3.1 explicitly delegates data flow to configurable backends: When you configure a cloud API, dialogue context will be sent to the selected service provider for inference; if you enable local LM, all inference and logs are limited to the local machine process. Strongly recommended:',
                'Disable online inference in multiplayer/online scenarios to reduce the risk of being detected/banned by official services;',
                'Enable content filtering and reporting mechanisms for production/public demonstration scenarios;',
                'Use independent API Keys for external services, and limit minimum permissions and shortest log retention periods in configuration.',
                'Relationship with Previous Versions',
                'v3.1 is an engineering upgrade to v3.0 (which introduced voice input, interactive menus, full NPC coverage, and automatic reactions) in terms of stability and configurability; it also inherits v2.0\'s memory system and emotional TTS capabilities. If you are upgrading from v1.x or v2.x, the process is a seamless migration: original memory and NPC data are compatible, and configuration files will be automatically generated on first run and attempt to retain old settings.',
                'Our Commitment',
                'We are committed to building NexusV into a first-class AI-NPC infrastructure: stable, configurable, and auditable. The release of v3.1 is a small step in engineering evolution, but for mod creators and technical demonstrators, it is a large step in tooling progress — turning complex model integration and low-latency voice delivery into a repeatable, tunable engineering process.',
                'Get Support & Feedback',
                'If you encounter problems during upgrade or use, discover content risks, or need enterprise-level deployment advice, please contact us via email: nexusv@139.com. We will respond within a reasonable time and assist in locating problems.',
                'Thanks to the community, testers, and feedback providers. Next, we will synchronize configuration documentation, example config.ini templates, and TTS tuning guides to the release page to facilitate quick start and reproduction. Welcome to share your experiments and scenarios to the repository issue, let us work together to make the virtual life of the open world more real and credible.',
                '— NexusV Team'
            ]
        }
    },
    news7: {
        media: { type: 'image', src: 'Logo/22.webp', alt: 'Sentience 登场' },
        zh: {
            title: 'Sentience 正式登场',
            date: '2026年2月26日',
            category: '产品',
            paragraphs: [
                '开放世界游戏的交互方式，正在发生变化。',
                '过去，NPC 依赖脚本与触发器运行。今天，随着本地推理能力的提升，我们开始探索另一种可能：让行为由模型驱动，而不是完全由预设逻辑决定。',
                '经过数周的封闭测试与底层架构重构，Sentience 正式发布。',
                '它不是一个对话插件，也不是简单的大模型接入。Sentience 是一个本地化行为推理系统。',
                '端侧原生推理',
                'Sentience 完全运行在用户本地 GPU 上。不依赖云端 API，不上传语音或行为数据，不进行外部推理调用。所有决策过程在显存中完成。',
                '这意味着：更低的延迟、更高的可控性、更明确的数据边界。在开放世界的高速场景中，推理延迟已压缩至可接受的实时范围，足以支持动态行为响应。',
                '行为级响应，而非台词生成',
                'Sentience 并非简单生成对话文本。它参与的是：行为选择、优先级判断、状态演化、情境记忆调用。',
                'NPC 不再只是执行固定脚本。它们会基于近期交互历史，调整后续行为逻辑。我们在连续长时间测试中验证：NPC 可以维持跨场景的行为连续性，并对玩家过去的选择产生可观察的反馈。',
                '这不是"意识"。但它是一种更接近决策结构的行为模型。',
                '本地记忆机制',
                '通过本地向量存储与状态缓存机制，Sentience 能保留关键交互节点，并在后续决策中调用。这让虚拟世界具备了一定程度的"持续性"。不是无限记忆，而是可管理、可控制的行为上下文。',
                '从工具到系统',
                'Sentience 只是起点。它代表一种方向：将 AI 推理能力，从云端接口转移到端侧可控的实时行为引擎。',
                '对于一个刚起步的团队而言，我们更关注架构的可持续性，而不是噱头式的智能幻觉。我们不会宣称创造了"数字生命"。我们只是尝试构建：一个可以稳定运行的行为系统。',
                '结语',
                'Sentience 是一次工程实验，不是终点。它验证了一件事：在本地算力逐渐普及的今天，实时行为模型是可行的。',
                '未来，我们将继续探索：如何让虚拟角色具备更稳定、更可解释、更可扩展的决策能力。',
                '这不是造神，这是结构优化。对于我们这个刚起步的团队而言，Sentience 只是火种。我们没有百万用户的喧嚣，但我们拥有对技术最纯粹的敬畏。'
            ]
        },
        en: {
            title: 'Sentience Officially Launches',
            date: 'February 26, 2026',
            category: 'Product',
            paragraphs: [
                'The way open-world games interact is changing.',
                'In the past, NPCs relied on scripts and triggers to run. Today, with the improvement of local inference capabilities, we are starting to explore another possibility: let behavior be driven by models, rather than completely determined by preset logic.',
                'After weeks of closed beta testing and underlying architecture refactoring, Sentience is officially released.',
                'It is not a dialogue plugin, nor is it a simple large model access. Sentience is a localized behavioral reasoning system.',
                'Edge-native Inference',
                'Sentience runs entirely on the user\'s local GPU. It does not rely on cloud APIs, does not upload voice or behavioral data, and does not make external inference calls. All decision-making processes are completed in the video memory.',
                'This means: lower latency, higher controllability, and clearer data boundaries. In high-speed scenarios of the open world, inference latency has been compressed to an acceptable real-time range, sufficient to support dynamic behavioral responses.',
                'Behavior-level Response, Not Line Generation',
                'Sentience does not simply generate dialogue text. It participates in: behavior selection, priority judgment, state evolution, and situational memory recall.',
                'NPCs no longer just execute fixed scripts. They will adjust subsequent behavioral logic based on recent interaction history. We verified in continuous long-term testing: NPCs can maintain cross-scene behavioral continuity and produce observable feedback on players\' past choices.',
                'This is not "consciousness". But it is a behavioral model closer to a decision structure.',
                'Local Memory Mechanism',
                'Through local vector storage and state caching mechanisms, Sentience can retain key interaction nodes and recall them in subsequent decisions. This gives the virtual world a certain degree of "continuity". Not infinite memory, but manageable and controllable behavioral context.',
                'From Tool to System',
                'Sentience is just the starting point. It represents a direction: transferring AI inference capabilities from cloud interfaces to edge-side controllable real-time behavior engines.',
                'For a startup team, we are more concerned with the sustainability of the architecture rather than gimmicky intelligent illusions. We will not claim to have created "digital life". We are just trying to build: a behavioral system that can run stably.',
                'Conclusion',
                'Sentience is an engineering experiment, not the end point. It verifies one thing: today, as local computing power is gradually popularized, real-time behavior models are feasible.',
                'In the future, we will continue to explore: how to equip virtual characters with more stable, explainable, and scalable decision-making capabilities.',
                'This is not creating a god; this is structural optimization. For our startup team, Sentience is just a spark. We don\'t have the noise of millions of users, but we have the purest awe of technology.'
            ]
        }
    },
    news8: {
        media: { type: 'image', src: 'Logo/introducing_the_gpt_store.webp', alt: '更新日志' },
        zh: {
            title: 'NexusV 更新日志',
            date: '2026 年 1 月 20 日',
            category: '产品',
            readTime: '8 分钟阅读',
            paragraphs: [
                '本文档记录了 NexusV 网站的最新版本更新内容。',
                'v1.0.0 - 2026 年 1 月 20 日',
                '新增功能',
                '• 研究下拉菜单：新增超级菜单设计，支持快速访问所有研究文章',
                '• 移动汉堡菜单：优化移动端导航体验，支持子菜单展开',
                '• 最新文章系统：新增"最新动态"栏目，支持双列网格布局',
                '• 视频懒加载：实现智能视频加载系统，支持白屏检测和自动降级',
                '• 主题切换：新增深浅色模式切换功能，支持系统偏好检测',
                '• 国际化支持：新增中英文双语切换，支持全站内容翻译',
                '• 搜索功能：新增全屏搜索覆盖层，支持文章快速查找',
                '• 留言系统：集成 Cusdis 评论系统，支持匿名留言',
                '性能优化',
                '• 首屏加载优化：关键 CSS 内联，非关键资源延迟加载',
                '• 图片优化：WebP 格式优先，支持渐进式加载',
                '• 动画优化：使用 CSS transform 替代 position 变化，GPU 加速',
                '• 代码分割：按页面拆分 JavaScript，减少初始加载体积',
                '• 缓存策略：实现 Service Worker 缓存，支持离线访问',
                'UI/UX 改进',
                '• 卡片悬停效果：优化图片缩放动画，使用 cubic-bezier 缓动',
                '• 响应式布局：适配桌面、平板、手机三种视口',
                '• 字体优化：使用 Inter 字体，支持多语言渲染',
                '• 滚动条美化：根据深浅色模式自动切换滚动条颜色',
                '• 无障碍改进：添加 ARIA 标签，支持键盘导航',
                'Bug 修复',
                '• 修复移动端菜单切换时的闪烁问题',
                '• 修复视频加载失败时的降级逻辑',
                '• 修复浅色模式下部分文字对比度不足',
                '• 修复搜索框在部分浏览器中的对齐问题',
                '技术栈',
                '• 前端：原生 HTML5 + CSS3 + Vanilla JavaScript',
                '• 样式：CSS 变量 + Flexbox + Grid 布局',
                '• 动画：CSS Transitions + Web Animations API',
                '• 国际化：自定义 i18n 系统，支持动态语言切换',
                '• 部署：Vercel 静态托管，支持全球 CDN 加速',
                '已知问题',
                '• Firefox 浏览器中部分动画效果略有差异',
                '• 部分旧版 Android 设备视频自动播放受限',
                '• Cusdis 评论系统在极少数网络环境下加载缓慢',
                '未来计划',
                '• 新增文章阅读进度指示器',
                '• 优化移动端手势支持',
                '• 新增文章收藏和分享功能',
                '• 改进搜索算法，支持模糊匹配',
                '• 新增深色模式自动切换（根据时间）',
                '反馈与支持',
                '如您在使用过程中遇到任何问题，请通过以下方式联系我们：',
                '• GitHub Issues: https://github.com/NexusVAI',
                '• 邮箱：nexusv@139.com',
                '感谢您使用 NexusV！'
            ]
        },
        en: {
            title: 'NexusV Changelog',
            date: 'January 20, 2026',
            category: 'Product',
            readTime: '8 min read',
            paragraphs: [
                'This document records the latest version updates of the NexusV website.',
                'v1.0.0 - January 20, 2026',
                'New Features',
                '• Research Dropdown Menu: New mega menu design for quick access to all research articles',
                '• Mobile Hamburger Menu: Optimized mobile navigation with submenu support',
                '• Latest Articles System: New "Latest News" section with dual-column grid layout',
                '• Video Lazy Loading: Smart video loading system with white screen detection and auto-fallback',
                '• Theme Switching: Light/dark mode toggle with system preference detection',
                '• Internationalization: Chinese/English bilingual support with full-site translation',
                '• Search Function: Full-screen search overlay for quick article lookup',
                '• Comment System: Integrated Cusdis for anonymous comments',
                'Performance Optimizations',
                '• First Screen Optimization: Critical CSS inlined, non-critical resources lazy-loaded',
                '• Image Optimization: WebP format priority with progressive loading',
                '• Animation Optimization: CSS transform instead of position changes, GPU accelerated',
                '• Code Splitting: JavaScript split by page, reduced initial load size',
                '• Caching Strategy: Service Worker caching implemented, offline support',
                'UI/UX Improvements',
                '• Card Hover Effects: Optimized image zoom animation with cubic-bezier easing',
                '• Responsive Layout: Adapted for desktop, tablet, and mobile viewports',
                '• Font Optimization: Inter font with multi-language rendering support',
                '• Scrollbar Styling: Auto-switching scrollbar colors based on theme',
                '• Accessibility: ARIA labels added, keyboard navigation support',
                'Bug Fixes',
                '• Fixed menu flickering issue during mobile menu switching',
                '• Fixed fallback logic when video loading fails',
                '• Fixed insufficient text contrast in light mode',
                '• Fixed search box alignment issues in some browsers',
                'Technology Stack',
                '• Frontend: Native HTML5 + CSS3 + Vanilla JavaScript',
                '• Styling: CSS Variables + Flexbox + Grid Layout',
                '• Animation: CSS Transitions + Web Animations API',
                '• Internationalization: Custom i18n system with dynamic language switching',
                '• Deployment: Vercel static hosting with global CDN acceleration',
                'Known Issues',
                '• Some animation effects vary slightly in Firefox browser',
                '• Video autoplay limited on some older Android devices',
                '• Cusdis comment system loads slowly in rare network conditions',
                'Future Plans',
                '• Add article reading progress indicator',
                '• Optimize mobile gesture support',
                '• Add article bookmarking and sharing features',
                '• Improve search algorithm with fuzzy matching',
                '• Add automatic dark mode switching (based on time)',
                'Feedback & Support',
                'If you encounter any issues, please contact us via:',
                '• GitHub Issues: https://github.com/NexusVAI',
                '• Email: nexusv@139.com',
                'Thank you for using NexusV!'
            ]
        }
    },
    news9: {
        media: { type: 'image', src: 'Logo/DALL.webp', alt: 'Sentience V4C' },
        zh: {
            title: '面向开放世界城市的NPC认知系统',
            date: '2026年3月05日',
            category: 'NexusV实验室',
            readTime: '10 分钟阅读',
            paragraphs: [
                '摘要（Abstract）',
                '我们提出 <a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4 Cogito（Sentience V4C）</a>，一种面向开放世界环境的 NPC 认知系统。该系统由中国模组工作室 NexusV 开发，运行于 Grand Theft Auto V 的虚拟城市 洛圣都（Los Santos） 中。',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> 的目标是将传统脚本化 NPC 转变为具备 感知、记忆，社会互动与自我认知能力的 AI 代理（AI Agents）。通过本地语言模型推理、动态区块加载、多层行为决策以及社会传播机制，NPC 不再只是预设行为的执行体，而成为能够在城市中持续演化的 自治个体。',
                '该系统探索一个核心问题：',
                '如果一个城市中的居民拥有记忆、动机与社交网络，虚拟社会是否会出现真实的涌现行为？',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> 旨在为开放世界游戏提供一种新的实验平台，用于研究 大规模 AI Agent 社会系统。',
                '系统架构（System Architecture）',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> 采用 混合式认知架构（Hybrid Cognitive Architecture），由四个核心层构成：',
                '环境感知层（Perception Engine）',
                '动机与目标系统（Goal & Motivation System）',
                '长期记忆与声望系统（Memory & Reputation）',
                'NPC 社交网络（Agent Gossip Network）',
                'AI 推理主要通过 本地部署的语言模型（LM Studio） 完成，从而实现完全离线的 NPC 认知模拟。',
                '为保证开放世界环境中的性能可扩展性，系统采用：',
                '区块式 NPC 加载机制（Chunk-Based NPC Loading）',
                '分叉注意力机制（Forked Attention System）',
                '脚本代理降级策略（Scripted Agent Fallback）',
                '这一架构允许在保持 AI 行为复杂性的同时维持稳定性能。',
                '感知与动机系统',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> 为 NPC 引入了基础的 环境感知能力。',
                'NPC 可以通过视觉与听觉信号检测环境中的关键事件，例如：',
                '枪声、爆炸、暴力行为、高速驾驶或危险驾驶',
                '这些信号被输入到 NPC 的 需求驱动模型（Need-Driven Model） 中。',
                '每个 NPC 都会动态平衡五种核心动机：',
                '安全（Safety）、社交（Social Interaction）、目标（Personal Goals）、好奇（Curiosity）、攻击性（Aggression）',
                '这一机制使 NPC 能够根据环境产生自然行为，例如：遇到危险时寻找掩体或逃离、长时间独处后主动与他人交谈、在低刺激环境下探索城市或休闲活动。',
                'NPC 还拥有 长期行为目标（Long-Horizon Intentions），这些目标由其个性和环境共同决定，例如：巡逻某个街区、前往海滩散步、在城市中驾车兜风。',
                '长期记忆与声望系统',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> 引入了 持续性行为记忆（Persistent Behavioral Memory）。NPC 会记录玩家在其观察范围内的行为，并将这些信息存储为长期记忆。这些记忆将直接影响未来的 NPC 反应。',
                '如果玩家在某个街区频繁制造暴力事件，当玩家再次出现时，当地 NPC 可能会表现出明显的恐惧反应。',
                'NPC 会根据玩家行为生成 行为标签（Behavior Tags），并在对话中使用这些标签形成玩家外号。例如：经常飙车 → "秋名山车神"、随意开枪 → "那个杀人狂"。',
                'NPC 同时具有 情绪容忍阈值（Tolerance Threshold）。如果玩家持续通过语言进行挑衅或侮辱，NPC 的情绪状态会逐渐升级，最终可能触发 暴怒反击行为。',
                'NPC 社交网络',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> 构建了一种简单的 NPC 社会信息传播机制。NPC 会在日常交流中交换信息，这些信息可能包括：玩家行为、城市事件、对某个角色的评价。',
                '这种机制形成了一个基础的 Agent Gossip Network（代理八卦网络）。例如，当玩家在某个区域实施暴力行为后，即使没有亲眼目睹事件的 NPC，也可能通过其他 NPC 的对话得知此事。这使得玩家声望可以通过 社会传播 在城市中扩散。',
                '自我认知与身份建模',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> 为 NPC 引入了基础的 自我表示。NPC 能够识别：自身性别、模型身份、社会角色。',
                '这一能力使 NPC 在对话中能够生成更符合自身身份的回答。虽然目前仍处于初级阶段，但这一系统为未来更复杂的 AI 角色人格系统奠定了基础。',
                '性能优化与分叉注意力机制',
                '在开放世界城市中，大规模 AI 推理会带来显著计算成本。为解决这一问题，<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> 引入了 分叉注意力机制。',
                'NPC 会被动态划分为多个认知层级：高注意力代理（使用本地语言模型进行推理，参与对话、决策和记忆更新）和低注意力代理（使用脚本行为或简化逻辑，主要执行基础动作与环境行为）。',
                '当玩家接近或事件发生时，NPC 可以在不同层级之间动态切换。这一策略允许系统在保持 行为复杂性 的同时显著降低推理负载。',
                '未来研究方向',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> 是一个长期研究项目，其核心目标是探索：如何将 AI 代理嵌入到完整的虚拟城市中。',
                '未来的发展方向包括：城市级 AI 社会模拟（构建包含大量自治 NPC 的城市生态，使 NPC 可以形成群体、关系网络和社会结构）、长期记忆社会系统（NPC 能够记住历史事件，并在城市中形成共享记忆）、LLM 驱动的动态对话（NPC 可以基于语境、记忆与个性进行更自然的互动）、涌现行为研究（观察当数百个 AI 代理在同一城市中互动时，是否会出现新的社会模式）。',
                '结语',
                '开放世界游戏提供了一个独特的实验环境：一个拥有空间人口与事件的 可计算城市。',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> 的目标不是简单地增强 NPC 行为，而是尝试回答一个更大的问题：如果一个城市中的居民拥有记忆、动机和社交能力，这个城市是否会"活"起来？',
                '洛圣都或许只是开始。'
            ]
        },
        en: {
            title: 'NPC Cognitive System for Open-World Cities',
            date: 'March 05, 2026',
            category: 'NexusV Lab',
            readTime: '10 min read',
            paragraphs: [
                'Abstract',
                'We present <a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4 Cogito (Sentience V4C)</a>, an NPC cognitive system for open-world environments. Developed by Chinese mod studio NexusV, the system runs in the virtual city of Los Santos from Grand Theft Auto V.',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> aims to transform traditional scripted NPCs into AI Agents with perception, memory, social interaction, and self-awareness capabilities. Through local language model inference, dynamic chunk loading, multi-layered behavioral decision-making, and social propagation mechanisms, NPCs are no longer just executors of preset behaviors but evolving autonomous individuals in the city.',
                'The system explores a core question:',
                'If the residents of a city have memory, motivation, and social networks, will a virtual society exhibit emergent behaviors?',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> aims to provide a new experimental platform for open-world games to study large-scale AI Agent social systems.',
                'System Architecture',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> adopts a Hybrid Cognitive Architecture consisting of four core layers:',
                'Perception Engine',
                'Goal & Motivation System',
                'Memory & Reputation',
                'Agent Gossip Network',
                'AI inference is primarily completed through locally deployed language models (LM Studio), enabling fully offline NPC cognitive simulation.',
                'To ensure scalability in open-world environments, the system employs:',
                'Chunk-Based NPC Loading',
                'Forked Attention System',
                'Scripted Agent Fallback',
                'This architecture allows maintaining stable performance while preserving AI behavioral complexity.',
                'Perception and Motivation System',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> introduces basic environmental awareness for NPCs.',
                'NPCs can detect key environmental events through visual and auditory signals, such as: gunshots, explosions, violent behavior, high-speed or dangerous driving.',
                'These signals are input into the NPC\'s Need-Driven Model. Each NPC dynamically balances five core motivations: Safety, Social Interaction, Personal Goals, Curiosity, and Aggression.',
                'This mechanism allows NPCs to generate natural behaviors based on environment: seeking cover or fleeing when in danger, initiating conversations after prolonged isolation, exploring the city or engaging in leisure activities in low-stimulation environments.',
                'NPCs also have Long-Horizon Intentions determined by their personality and environment, such as patrolling a neighborhood, going to the beach for a walk, or driving around the city.',
                'Memory and Reputation System',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> introduces Persistent Behavioral Memory. NPCs record player behaviors within their observation range and store them as long-term memories, which directly affect future NPC reactions.',
                'If a player frequently causes violent incidents in a certain neighborhood, local NPCs may show obvious fear reactions when the player returns.',
                'NPCs generate Behavior Tags based on player behavior and use these tags to form nicknames during conversations. For example: frequent speed racing → "Mountain Racer", random shooting → "That Killer".',
                'NPCs also have a Tolerance Threshold. If players continuously provoke or insult through language, NPC emotional states gradually escalate and may eventually trigger violent counterattack behavior.',
                'NPC Social Network',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> constructs a simple NPC social information propagation mechanism. NPCs exchange information during daily interactions, which may include: player behavior, city events, evaluations of certain characters.',
                'This forms a basic Agent Gossip Network. For example, after a player commits violent acts in an area, NPCs who didn\'t witness the event may learn about it through conversations with other NPCs. This allows player reputation to spread through social transmission throughout the city.',
                'Self-Awareness and Identity Modeling',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> introduces basic Self Representation for NPCs. NPCs can identify: their own gender, model identity, and social role.',
                'This ability allows NPCs to generate responses more aligned with their identity during conversations. While still in its early stages, this system lays the foundation for more complex AI character personality systems in the future.',
                'Performance Optimization and Forked Attention',
                'Large-scale AI inference in open-world cities brings significant computational costs. To solve this, <a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> introduces the Forked Attention System.',
                'NPCs are dynamically divided into cognitive tiers: High-Attention Agents (using local language models for inference, participating in dialogue, decision-making, and memory updates) and Low-Attention Agents (using scripted behaviors or simplified logic, primarily executing basic actions and environmental behaviors).',
                'When players approach or events occur, NPCs can dynamically switch between tiers. This strategy allows the system to maintain behavioral complexity while significantly reducing inference load.',
                'Future Research Directions',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a> is a long-term research project with the core goal of exploring how to embed AI agents into complete virtual cities.',
                'Future development directions include: City-Level AI Social Simulation (building urban ecosystems with large numbers of autonomous NPCs that can form groups, relationship networks, and social structures), Long-Term Memory Social Systems (NPCs can remember historical events and form shared memories in the city), LLM-Driven Dynamic Dialogue (NPCs can interact more naturally based on context, memory, and personality), Emergent Behavior Research (observing whether new social patterns emerge when hundreds of AI agents interact in the same city).',
                'Conclusion',
                'Open-world games provide a unique experimental environment: a computable city with spatial populations and events.',
                '<a href="article.html?id=sentienceV4C" style="text-decoration: underline; color: inherit;">Sentience V4C</a>\'s goal is not simply to enhance NPC behavior, but to attempt to answer a bigger question: If the residents of a city have memory, motivation, and social capabilities, will the city "come alive"?',
                'Los Santos may just be the beginning.'
            ]
        }
    }
};

function swapArticleEntries(keyA, keyB) {
    if (!articleData[keyA] || !articleData[keyB]) return;
    const temp = articleData[keyA];
    articleData[keyA] = articleData[keyB];
    articleData[keyB] = temp;
}

swapArticleEntries('n2', 'news2');

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ARTICLE_ALLOWED_TAGS = new Set(['A', 'BR', 'CODE', 'EM', 'I', 'STRONG', 'B']);

function isSafeArticleHref(href) {
    try {
        const url = new URL(href, window.location.href);
        return url.origin === window.location.origin && /\/article\.html$/i.test(url.pathname);
    } catch {
        return false;
    }
}

function sanitizeArticleNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return document.createTextNode('');
    }

    const tag = node.tagName.toUpperCase();
    if (!ARTICLE_ALLOWED_TAGS.has(tag)) {
        const fragment = document.createDocumentFragment();
        node.childNodes.forEach(child => {
            fragment.appendChild(sanitizeArticleNode(child));
        });
        return fragment;
    }

    const el = document.createElement(tag.toLowerCase());
    if (tag === 'A') {
        const href = node.getAttribute('href') || '';
        if (!isSafeArticleHref(href)) {
            const fragment = document.createDocumentFragment();
            node.childNodes.forEach(child => {
                fragment.appendChild(sanitizeArticleNode(child));
            });
            return fragment;
        }
        el.setAttribute('href', href);
    }

    node.childNodes.forEach(child => {
        el.appendChild(sanitizeArticleNode(child));
    });
    return el;
}

function renderArticleParagraph(p, html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.childNodes.forEach(child => {
        p.appendChild(sanitizeArticleNode(child));
    });
}

function initArticlePage() {
    const articleRoot = document.querySelector('.article-page');
    if (!articleRoot) return;

    const params = new URLSearchParams(window.location.search);
    const id = params.get('id') || 'hero';
    const quoteSwitcherEl = document.querySelector('[data-quote-switcher]');
    const quoteTabs = quoteSwitcherEl ? Array.from(quoteSwitcherEl.querySelectorAll('[data-quote-tab]')) : [];
    const quoteTextEl = quoteSwitcherEl ? quoteSwitcherEl.querySelector('.quote-switcher-text') : null;
    const quoteSlides = {
        zh: [
            {
                tab: 'Ethan',
                text: '有位玩家和一个警察 NPC 对喷了很久，照理说好感度应该一路往下掉，掉到谷底后要么对方离开、要么敌对、要么继续互怼。结果反而出现了反向增长。更离谱的是，玩家嘴完离开后直接吃到两星通缉，刚才那个警察还说“我受够你了”然后开火。虽然没录到，但这段体验非常能说明这个模组的真实反馈强度。'
            },
            {
                tab: 'Mia',
                text: '这段“警察反转时刻”确实很难忘。不管是系统机制刚好命中，还是复杂行为偶然涌现，整体表现都足够惊艳，完全可以放进宣传片。对我们来说，这就是最有代表性的成功案例之一。'
            }
        ],
        en: [
            {
                tab: 'Ethan',
                text: 'Yo, so one player was chattin\' with this cop NPC, kept throwin\' insults left and right. But get this — his affinity score (like, his rep for that player) was actually goin\' UP, not down. Shoulda been droppin\' \'til it hit rock bottom, then either he books it, walks off, turns hostile, or they just go back and forth roastin\' each other. Then the plot twist hits — after that player finished clownin\' him and dipped, they caught a 2-star wanted level! That same cop they were just dissin\' deadass says, "I\'ve had enough of you!" and starts blastin\' them. They didn\'t even hit record — super frustrating. But honestly, this just proves how fire this mod really is.'
            },
            {
                tab: 'Mia',
                text: 'Man, I feel you — that cop moment is straight-up unforgettable. I don\'t know if it was the mod doing its thing or just some wild magic, but holy smokes, that was insane. That alone belongs in the promo trailer. This is our success story right here, bro — legendary.'
            }
        ]
    };

    function renderQuoteSwitcher(lang) {
        if (!quoteSwitcherEl || !quoteTextEl || quoteTabs.length < 2) return;
        if (id !== 'sentienceV4C') {
            quoteSwitcherEl.hidden = true;
            return;
        }
        quoteSwitcherEl.hidden = false;
        const slides = quoteSlides[lang] || quoteSlides.zh;
        const maxIndex = slides.length - 1;
        let currentIndex = Number(quoteSwitcherEl.dataset.currentIndex || 0);
        if (!Number.isFinite(currentIndex) || currentIndex < 0) currentIndex = 0;
        if (currentIndex > maxIndex) currentIndex = maxIndex;
        quoteSwitcherEl.dataset.currentIndex = String(currentIndex);

        quoteTabs.forEach((tab, index) => {
            const active = index === currentIndex;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.textContent = (slides[index] && slides[index].tab) || '';
        });

        quoteTextEl.textContent = `“${slides[currentIndex].text}”`;
    }

    if (quoteTabs.length) {
        quoteTabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                if (!quoteSwitcherEl) return;
                quoteSwitcherEl.dataset.currentIndex = tab.getAttribute('data-quote-tab') || '0';
                const currentLang = localStorage.getItem('lang') || 'zh';
                renderQuoteSwitcher(currentLang);
            });
        });
    }
    
    // Render function to be called on init and lang change
    function renderArticle(lang) {
        const item = articleData[id] || articleData.hero;
        const data = item[lang] || item.zh; // Fallback to zh if en missing (though we filled all)
        const media = item.media; // Correctly accessing top-level media

        const dateEl = articleRoot.querySelector('.article-date');
        const categoryEl = articleRoot.querySelector('.article-category');
        const titleEl = articleRoot.querySelector('.article-title');
        const bodyEl = articleRoot.querySelector('.article-body');
        const authorPill = articleRoot.querySelector('.author-pill');
        const crGrid = articleRoot.querySelector('.cr-grid');

        if (dateEl) dateEl.textContent = data.date;
        if (categoryEl) categoryEl.textContent = data.category;
        if (titleEl) titleEl.textContent = data.title;
        document.title = `${data.title} | NexusV`;
        
        if (authorPill && data.date) {
            const year = data.date.match(/\d{4}/);
            if (year) authorPill.textContent = `${year[0]} ${lang === 'en' ? '' : '年'}`;
        }

        if (bodyEl) {
            bodyEl.replaceChildren();
            (data.paragraphs || []).forEach(t => {
                const p = document.createElement('p');
                renderArticleParagraph(p, t);
                bodyEl.appendChild(p);
            });
        }

        renderQuoteSwitcher(lang);

        if (crGrid) {
            crGrid.innerHTML = ''; // Clear existing
            // Randomly display 3 different articles
            const allKeys = Object.keys(articleData).filter(k => k !== id);
            
            // Fisher-Yates shuffle
            for (let i = allKeys.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [allKeys[i], allKeys[j]] = [allKeys[j], allKeys[i]];
            }
            
            const selectedKeys = allKeys.slice(0, 3);
            
            selectedKeys.forEach(key => {
                const crItem = articleData[key];
                if (!crItem) return;
                
                const crData = crItem[lang] || crItem.zh;
                const card = document.createElement('a');
                card.className = 'cr-card';
                card.href = `article.html?id=${key}`;
                
                // Use shared media object
                const mediaObj = crItem.media;
                const fallbackImg = (mediaObj && mediaObj.poster) || "Logo/I2.webp";
                const posterOnError = `this.onerror=null;this.src='Logo/I2.webp'`;
                const imageOnError = `this.onerror=null;this.src='${fallbackImg}'`;

                let mediaHtml = '';
                // 在继续阅读区域，视频类型只显示海报图，不加载视频以避免闪烁问题
                if (mediaObj && mediaObj.type === 'video') {
                    mediaHtml = `<div class="image-wrapper square-image"><img src="${fallbackImg}" alt="${(mediaObj && mediaObj.alt) || ''}" loading="lazy" decoding="async" onerror="${posterOnError}"></div>`;
                } else {
                    let src = (mediaObj && mediaObj.src) || fallbackImg;
                    if (key === 'news1') src += '?t=1'; // Cache buster for news1
                    mediaHtml = `<div class="image-wrapper square-image"><img src="${src}" alt="${(mediaObj && mediaObj.alt) || ''}" loading="lazy" decoding="async" onerror="${imageOnError}"></div>`;
                }

                card.innerHTML = `
                    ${mediaHtml}
                    <h4>${escapeHtml(crData.title)}</h4>
                    <div class="meta"><span class="news-category">${escapeHtml(crData.category)}</span> ${escapeHtml(crData.date)}</div>
                `;
                crGrid.appendChild(card);
            });
        }
        if (window.initLazyVideo) window.initLazyVideo();
    }

    // Initial render
    const currentLang = localStorage.getItem('lang') || 'zh';
    renderArticle(currentLang);

    // Listen for language changes
    window.addEventListener('languageChanged', (e) => {
        renderArticle(e.detail.lang);
    });

    // Share button logic
    const shareBtn = articleRoot.querySelector('.share-link-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            const url = window.location.href;
            try {
                await navigator.clipboard.writeText(url);
                const originalHTML = shareBtn.innerHTML;
                const currentLang = localStorage.getItem('lang') || 'zh';
                const copiedText = currentLang === 'zh' ? '已复制链接' : 'Link Copied';
                
                shareBtn.classList.add('share-success');
                shareBtn.innerHTML = `
                    <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    <span>${copiedText}</span>
                `;
                
                setTimeout(() => {
                    shareBtn.classList.remove('share-success');
                    shareBtn.innerHTML = originalHTML;
                    // Trigger reflow
                    const newSpan = shareBtn.querySelector('span');
                    const newIcon = shareBtn.querySelector('svg');
                    if (newSpan) {
                        newSpan.style.animation = 'none';
                        newSpan.offsetHeight; 
                        newSpan.style.animation = 'fadeIn 0.3s ease';
                    }
                    if (newIcon) {
                        newIcon.style.animation = 'none';
                        newIcon.offsetHeight;
                        newIcon.style.animation = 'fadeIn 0.3s ease';
                    }
                }, 2000);
            } catch (err) {
                console.error('Failed to copy: ', err);
            }
        });
    }
}

function initIndexPage() {
    const heroCard = document.querySelector('.hero-card');
    const scrollableList = document.querySelector('.scrollable-list');
    const newsGrid = document.querySelector('.news-grid-2-col');
    const featureStrip = document.querySelector('.latest-news-feature-strip');
    
    // Only proceed if at least one of these exists (indicating we are on index-like page)
    if (!heroCard && !scrollableList && !newsGrid && !featureStrip) return;

    function renderIndex(lang) {
        // Scrollable List (sentienceV52mens, tactfr627, news3)
        if (scrollableList) {
            scrollableList.innerHTML = '';
            const listIds = ['sentienceV52mens', 'tactfr627', 'news3'];
            const linkTargets = ['sentienceV52mens', 'tactfr627', 'news3'];
            
            listIds.forEach((id, index) => {
                 const item = articleData[id];
                 if (!item) return;
                 const data = item[lang] || item.zh;
                 const card = document.createElement('a');
                 card.className = 'card-link side-card';
                 card.href = `article.html?id=${linkTargets[index]}`;
                 
                 const fallbackImg = (item.media && item.media.poster) || "Logo/I2.webp";
                 const posterOnError = `this.onerror=null;this.src='Logo/I2.webp'`;
                 const imageOnError = `this.onerror=null;this.src='${fallbackImg}'`;

                 let mediaHtml = '';
                 if (item.media && item.media.type === 'video' && item.media.src) {
                    mediaHtml = `
                        <div class="image-wrapper square-image lazy-video-wrapper">
                            <img src="${fallbackImg}" alt="${(item.media && item.media.alt) || ''}" class="video-poster" loading="lazy" decoding="async" onerror="${posterOnError}" style="position: absolute; inset: 0; z-index: 2;">
                            <video loop muted playsinline class="hero-video" data-src="${item.media.src}" data-fallback="${fallbackImg}" data-fit="${item.media.fit || 'cover'}" data-bg="${item.media.bg || ''}" preload="none" style="position: absolute; inset: 0; z-index: 1; opacity: 0;"></video>
                            <span class="card-overlay-text">${item.overlay || ''}</span>
                        </div>
                    `;
                 } else {
                    const imgSrc = (item.media && item.media.src) || fallbackImg;
                    mediaHtml = `
                        <div class="image-wrapper square-image">
                            <img src="${imgSrc}" alt="${(item.media && item.media.alt) || ''}" loading="lazy" decoding="async" onerror="${imageOnError}">
                            <span class="card-overlay-text">${item.overlay || ''}</span>
                        </div>
                    `;
                 }

                 card.innerHTML = `
                    ${mediaHtml}
                    <div class="card-text">
                        <h3 class="card-title">${escapeHtml(data.title)}</h3>
                        <p class="card-meta"><span>${escapeHtml(data.category)}</span> <span class="meta-time">${escapeHtml(data.readTime)}</span></p>
                    </div>
                 `;
                 scrollableList.appendChild(card);
            });
        }

        // News Grid (n2, news1...news8)
        if (newsGrid) {
            newsGrid.innerHTML = '';
            ['news10', 'n2', 'news9', 'news1', 'news2', 'sentienceOriginal', 'news4', 'news5', 'n1', 'news7', 'news8'].forEach(id => {
                const item = articleData[id];
                if (!item) return;
                const data = item[lang] || item.zh;
                const card = document.createElement('a');
                card.className = 'news-item-row';
                card.href = `article.html?id=${id}`;
                
                const fallbackImg = "Logo/I2.webp";
                let src = (item.media && item.media.src) || fallbackImg;
                if (id === 'news1') src += '?t=1';
                
                const onError = `this.onerror=null;this.src='${fallbackImg}'`;
                
                card.innerHTML = `
                    <div class="news-thumb">
                        <img src="${src}" alt="${escapeHtml((item.media && item.media.alt) || '')}" loading="lazy" decoding="async" onerror="${onError}">
                    </div>
                    <div class="news-info">
                        <h3>${escapeHtml(data.title)}</h3>
                        <p><span class="news-category">${escapeHtml(data.category)}</span> ${escapeHtml(data.date)}</p>
                    </div>
                `;
                newsGrid.appendChild(card);
            });
        }

        if (featureStrip) {
            featureStrip.innerHTML = '';
            ['news9', 'n2', 'n1', 'sentienceOriginal'].forEach(id => {
                const item = articleData[id];
                if (!item) return;
                const data = item[lang] || item.zh;
                const card = document.createElement('a');
                card.className = 'latest-news-feature-card';
                card.href = `article.html?id=${id}`;

                const fallbackImg = (item.media && item.media.src) || 'Logo/I2.webp';
                const onError = `this.onerror=null;this.src='Logo/I2.webp'`;

                card.innerHTML = `
                    <div class="latest-news-feature-thumb">
                        <img src="${fallbackImg}" alt="${escapeHtml((item.media && item.media.alt) || '')}" loading="lazy" decoding="async" onerror="${onError}">
                    </div>
                    <div class="latest-news-feature-info">
                        <h3>${escapeHtml(data.title)}</h3>
                        <p><span class="news-category">${escapeHtml(data.category)}</span> ${escapeHtml(data.date)}</p>
                    </div>
                `;
                featureStrip.appendChild(card);
            });
        }
        if (window.initLazyVideo) window.initLazyVideo();
    }

    const currentLang = localStorage.getItem('lang') || 'zh';
    renderIndex(currentLang);
    
    window.addEventListener('languageChanged', (e) => {
        renderIndex(e.detail.lang);
    });
}

window.articleData = articleData;
window.initArticlePage = initArticlePage;
window.initIndexPage = initIndexPage;
