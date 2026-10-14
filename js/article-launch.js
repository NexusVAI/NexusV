/* ============================================================================
 * article-launch.js — 发布稿版式（参考 Anthropic 模型发布页）
 *
 * articleData[id].layout === 'launch' 时，article.js 把渲染交给这里：
 *   封面图 Hero（日期 + (1)(2)(3)(4) 点线目录）→ 象牙色正文栏 → 对比网格 /
 *   简表 / 折线图 / 脚注。内容块定义在 LAUNCH_CONTENT，按 zh / en 各一份。
 *
 * 行内 HTML 走 article.js 的 renderArticleParagraph（同一套白名单消毒），
 * 表格与图表只用 textContent / SVG DOM 生成，不拼接 innerHTML。
 * ========================================================================== */
(function () {
    'use strict';

    // 内部评测（2026-09）：SWE-bench 5 题，模型 DeepSeek-V4.1-Flash（deepseek-flash），
    // 低谷时段价格。数据源 results_gui/summary.csv；耗时为各题 wall_s 之和。
    var EVAL = {
        Low: { cost: 0.24, total: 1.18, input: '13.6M', output: '185K', cache: '98.7%', minutes: 34 },
        High: { cost: 0.32, total: 1.60, input: '23.8M', output: '228K', cache: '99.1%', minutes: 61 },
        Ultracode: { cost: 0.36, total: 1.82, input: '27.0M', output: '256K', cache: '99.1%', minutes: 65 }
    };

    function evalSeries(name) {
        return [{
            name: name,
            color: '#6fa3d8',
            emphasis: true,
            points: ['Low', 'High', 'Ultracode'].map(function (k) { return [EVAL[k].cost, 100, k]; })
        }];
    }

    var DOWNLOAD_URL = 'https://www.nexusvai.xyz/cancricode/';

    var LAUNCH_CONTENT = {
        cancriCode3: {
            zh: {
                eyebrow: '2026 年 9 月 26 日',
                heading: 'Cancri Code 3：见识一下你的软件工程师',
                toc: [
                    { id: 'introduction', label: '引言' },
                    { id: 'how-it-works', label: '它怎么干活' },
                    { id: 'cloud-sandbox', label: '云沙箱' },
                    { id: 'availability', label: '现在可用' }
                ],
                blocks: [
                    { t: 'anchor', id: 'introduction' },
                    { t: 'summary', text: '今天我们发布 Cancri Code 3。它读得懂你的整个项目，在一台隔离的云端机器上动手，改完先验证，再交给你。这一版最大的变化只有一句话：动手的那一部分，从你的电脑搬到了云上。' },
                    { t: 'p', html: '先看一件真事。我们把一套影子后端整个搬进云沙箱，然后照最坏的情况去打它——不连生产、不用真凭证，全程由 Cancri Code 自己完成。下面是这次红蓝队演练的记录。' },
                    { t: 'compare', tab: '红蓝队演练', replayLabel: '重播回复动画', prompt: '我想做红蓝队测试：云端当影子后端，本地给云端搞破坏。云端就是你的云沙箱，有疑问一定要问我。',
                        sides: [
                            { label: '红队 · 攻击面', toggleLabel: '红队', response: [
                                { p: '开工前它只问了四个问题——影子范围、执行方式、演练维度、护栏；确认一次之后，全程没有再打扰人。沙箱没有对外入站端口，所以"搞破坏"改在沙箱内部执行：攻击脚本部署进去，打的是那台随后就被回收的机器，生产与本机全程零接触。' },
                                { code: '43 例安全套件 · 21 例模型类型矩阵\n混沌三组：client 21 / stream 15 / server 18\npgbench 50 并发 · 占位回收演练' },
                                { p: '250+ 次对抗与验证请求之后，没有一条有效绕过：伪造的身份与内部头被完全无视，8MB 请求体被 413 拒收，2000 层嵌套正常处理；反滥用守卫的完整反击链也被当场复现——前 4 次连发正常，第 5 次触发挑战，继续连发升格为封禁一小时。' }
                            ] },
                            { label: '蓝队 · 对账与观测', toggleLabel: '蓝队', response: [
                                { p: '每打完一批，蓝队就对着账本核一遍：钱包、台账、<code>api_usage</code>、占位行、幂等键，逐笔过。账目一行不差：' },
                                { code: '终账  99,653,500 = 100,000,000 − 346,500\n35 笔成功调用 × ¥0.0099\n226 consume / 191 refund 全对平\n占位残留 0 · 重复计费 0 · 负余额 0' },
                                { p: '被拒绝的每一笔（403 / 429 / 413 / 502 / 503）都自动退款；50 并发压账零漂移，占位回收演练把在途的 50 笔全额收回。它还留下两个不替人下结论的疑点——server 类故障矩阵与 9 月 7 日基线有 12/18 处偏差，网关对 <code>messages</code> 类型不做本地校验。两条都标着"待裁决"，交回给人。' }
                            ] }
                        ],
                        caption: '2026 年 9 月 27 日 · 模型 DeepSeek-V4.1-Flash · 全程无人干预：64 步、146 次工具调用、约一小时 · 沙箱计费 3600 秒 ≈ ¥0.86 · 本机既有文件一行未改，证据包 121KB。' },
                    { t: 'p', html: '六月我们第一次介绍 Cancri Code 的时候，它还是一个坐在你编辑器旁边的助手：能读代码、能改文件、能跑命令，但所有事情都发生在你自己的机器上。三个多月过去，我们越来越确定一件事——一个真正能被托付工作的工程师，得有自己的工位。' },
                    { t: 'p', html: 'Cancri Code 3 就是按这个想法重做的。它的工位是一台由我们和派欧云（PPIO）共同运营的弹性云沙箱：每个任务一台，按需启动，闲置自动暂停，做完就收回。你的电脑只负责和它说话、看它干活、在关键处点头。' },
                    { t: 'p', html: '下面是这一版里你会感受到的变化：' },
                    { t: 'p', html: '<strong>云端工位。</strong>压测、跑陌生脚本、装一大堆依赖、做安全测试，这些以前要在你电脑上的虚拟机里完成的事，现在全部在云端隔离容器里进行。不用装虚拟化软件，不占你的 CPU 和内存，出了事影响的也只是一台马上会被回收的机器。' },
                    { t: 'p', html: '<strong>会开浏览器。</strong>云沙箱分两种用途：一种专门跑代码，一种带一个真实的浏览器。选后者，Cancri Code 会自己打开页面、点击、填表、截图，你可以在旁边实时看着它操作。只有在浏览器里才能复现的问题，从此也在它的工作范围之内。' },
                    { t: 'p', html: '<strong>先取证，后下结论。</strong>我们把"没验证过就不算做完"写进了它的每一个档位。它会先让读到的代码、实际跑出来的输出和你描述的现象三者对上，再动手；档位越高，它对结论的出处要求越严，最高一档会标明每条判断来自哪一行代码或哪一次运行。' },
                    { t: 'p', html: '<strong>一个人，一支小队。</strong>计划模式、子任务、独立工作树、项目规则与记忆在这一版里配合得更顺。一件大事可以先出计划，再拆给几个子任务并行推进，彼此不踩脚；你立下的规矩，它记住一次就会一直遵守。' },
                    { t: 'p', html: '<strong>每一步都摊在桌面上。</strong>它读了哪些文件、搜了什么、跑了什么命令、改了哪几行，都会原样出现在对话里。写文件和执行有副作用的操作要经过你的审批，你随时可以叫停。' },

                    { t: 'h2', id: 'how-it-works', text: '它怎么干活' },
                    { t: 'p', html: '很多 AI 编程工具的问题不在于不够聪明，而在于太急。它们读到一半就开始写，写完就宣布修好了。我们花在 Cancri Code 身上最多的力气，恰恰是让它慢下来的那部分：什么时候该多看一眼，什么时候该停下来问，什么时候可以放手去做。' },
                    { t: 'p', html: '这些分寸没法用一条规则写死，所以我们把它做成了一根滑杆。Cancri Code 3 有四个努力档位——Low、Medium、High、Ultracode。它们调的不是模型"有多聪明"，而是它在动手之前愿意花多少力气取证、在交付时对自己的结论有多较真。' },
                    { t: 'grid', title: '四个努力档位分别多做了什么', subject: 1, columns: ['Low', 'Medium（默认）', 'High', 'Ultracode'], rows: [
                        { label: '滑杆区间', sub: '0–100', cells: ['0–32', '33–65', '66–99', '100'] },
                        { label: '意图清楚时直接动手', sub: '不先列计划、不先请示', cells: ['✓', '—', '—', '—'] },
                        { label: '动手前对齐现状', sub: '代码、运行输出、你描述的现象', cells: ['—', '✓', '✓', '✓'] },
                        { label: '按你的意图给情境提示', sub: '命中才给，不命中不打扰', cells: ['—', '✓', '✓', '✓'] },
                        { label: '结论标明出处', sub: '引用具体文件行或运行输出', cells: ['—', '—', '✓', '✓'] },
                        { label: '证据强度排序', sub: '运行时证据优先于文档与推测', cells: ['—', '—', '—', '✓'] },
                        { label: '区分根治与临时兜底', sub: '临时方案会被标出来', cells: ['—', '—', '—', '✓'] }
                    ], caption: '所有档位共用两条底线：不猜文件路径与标识符；没验证过的，就说没验证过。' },
                    { t: 'p', html: '有两处设计可能和你的直觉相反，值得多说两句。' },
                    { t: 'p', html: '第一，Low 并不是"降低标准"。模型天生倾向于走最保守的路：先列计划、先列假设、先问一句"要不要继续"。对一个改文案的小活来说，这些仪式比活本身还长。所以 Low 档反而要明确地把裁量权交给它——意图清楚就直接做，探索够判断就停。' },
                    { t: 'p', html: '第二，最严格的档位会在对话进行到第四轮时自动"瘦身"。Ultracode 的完整标准只在前三轮原样给出，之后换成精简版：骨架全在，措辞更短。前三轮用来把标准立住，后面每一轮再重复一遍完整文本，只是在替你多付 token。' },

                    { t: 'h2', id: 'evaluation', text: '我们跑了一轮' },
                    { t: 'p', html: '档位到底值不值那份钱，与其讲道理，不如跑一遍。我们从 SWE-bench 里挑了 5 道题——每道都是开源项目里一个真实的 GitHub issue，配着这个项目自己的测试——用同一个模型（DeepSeek-V4.1-Flash），让 Low、High、Ultracode 三个档位各自从头做一遍，再逐题评测是否解决。' },
                    { t: 'grid', title: '同一组 5 道题，三个档位', subject: 0, columns: ['Low', 'High', 'Ultracode'], rows: [
                        { label: '解决', sub: '5 道题', cells: ['5/5', '5/5', '5/5'], win: [0, 1, 2] },
                        { label: '每题均价', sub: '人民币', cells: ['0.24 元', '0.32 元', '0.36 元'], win: [0] },
                        { label: '5 题合计', sub: '人民币', cells: ['1.18 元', '1.60 元', '1.82 元'], win: [0] },
                        { label: '输入 token', sub: '含缓存读取', cells: ['13.6M', '23.8M', '27.0M'], win: [0] },
                        { label: '输出 token', cells: ['185K', '228K', '256K'], win: [0] },
                        { label: '缓存命中率', cells: ['98.7%', '99.1%', '99.1%'], win: [1, 2] },
                        { label: '总耗时', sub: '5 题合计', cells: ['34 分钟', '61 分钟', '65 分钟'], win: [0] }
                    ], caption: '模型 DeepSeek-V4.1-Flash，按 DeepSeek 官网低谷时段价格计费。' },
                    { t: 'grid', title: '逐题：每题成本 · 耗时', subject: 0, columns: ['Low', 'High', 'Ultracode'], rows: [
                        { label: 'pytest', sub: 'pytest-dev__pytest-10051', cells: ['0.08 元 · 5 分钟', '0.03 元 · 1 分钟', '0.04 元 · 1 分钟'], win: [1] },
                        { label: 'pylint', sub: 'pylint-dev__pylint-6386', cells: ['0.24 元 · 6 分钟', '0.32 元 · 13 分钟', '0.74 元 · 20 分钟'], win: [0] },
                        { label: 'sympy', sub: 'sympy__sympy-12489', cells: ['0.16 元 · 5 分钟', '0.28 元 · 12 分钟', '0.26 元 · 7 分钟'], win: [0] },
                        { label: 'django', sub: 'django__django-15554', cells: ['0.26 元 · 7 分钟', '0.58 元 · 22 分钟', '0.43 元 · 29 分钟'], win: [0] },
                        { label: 'django', sub: 'django__django-11885', cells: ['0.44 元 · 12 分钟', '0.39 元 · 13 分钟', '0.35 元 · 8 分钟'], win: [2] }
                    ], caption: '题目来自 SWE-bench，标注为 SWE-bench 实例编号。每格为该档位在这道题上的花费与耗时，高亮为该题最省的档位。' },
                    { t: 'chart', title: '解决率 vs 每题成本', subtitle: '同一模型，三个努力档位', xLabel: '每题成本（元）', yLabel: '解决率（%）', xTicks: [0.2, 0.25, 0.3, 0.35, 0.4], xFixed: 2,yMax: 100, yStep: 20, series: evalSeries('Cancri Code 3 · DeepSeek-V4.1-Flash'), note: '三个档位都解决了全部 5 道题；档位越高，每题成本越高。在这组题的难度上，Low 是成本最低的那个点。' },
                    { t: 'p', html: '结果很朴素：三个档位全部 5/5。区别在账单和时间上——从 Low 到 Ultracode，每题成本从 0.24 元涨到 0.36 元，多了一半；总耗时从 34 分钟拉长到 65 分钟，将近翻倍；输入 token 也翻了一倍，多出来的基本都是反复读代码、反复验证。逐题看并不整齐：简单的 pytest 那道，高档位反而一分钟就收工，比 Low 还省；真正拉开差距的是 pylint 和 django 这类需要来回翻代码的题。' },
                    { t: 'p', html: '有两点值得说清楚。第一，成本能压得这么低，靠的是缓存：三个档位的缓存命中率都在 99% 上下，绝大部分输入是按缓存价计的。第二，这组题 Low 就能做完，所以高档位多花的钱在这里没有换来更高的解决率——它换来的是更多的取证和更长的核对。在更难、更容易出错的任务上，这笔钱才会开始体现价值，而那需要更大的题集去证明，我们会继续跑。' },
                    { t: 'p', html: '5 道题是个小样本，我们不打算用它下什么大结论。它能说明的只有一件事：档位是一个真实的取舍，不是营销话术——你能从账单上看见它。' },

                    { t: 'h2', id: 'coding', text: '编码' },
                    { t: 'p', html: 'Cancri Code 最擅长的，是那种又长又散、需要在很多文件之间来回走的活：跨模块的重构、框架升级、一套接口换成另一套、把几十个文件里的同一种写法统一掉。' },
                    { t: 'p', html: '它看代码的方式和人很像，只是更有耐心。先用语义检索在整个仓库里找到相关的地方，再用语言服务器确认一个符号到底被谁引用、一处改动会不会让别的文件报错；需要的话，它会开一个独立的工作树去试，不碰你正在写的分支。改完之后，它会自己跑测试、看诊断信息，确认项目还能跑，才把结果交回来。' },
                    { t: 'p', html: '拿一个再常见不过的场景举例：某个接口"偶尔"超时。一个急性子的助手会找到看起来最可疑的那一行，加个重试，然后告诉你修好了。Cancri Code 会先设法复现——在云沙箱里把服务跑起来、把请求压上去，直到超时真的出现；再缩小范围，看是连接池、锁还是某个下游；定位到原因后才改，并留下一个能让这个问题不再悄悄回来的测试。它交给你的不是一句"修好了"，而是一条从现象到原因再到验证的完整链路。' },
                    { t: 'p', html: '这条链路也是你判断它靠不靠谱的依据。我们希望你看它的工作，就像看一位靠谱同事的提交记录：不必每行都读，但随时可以追问任何一步为什么这么做。' },

                    { t: 'h2', id: 'communication', text: '沟通' },
                    { t: 'p', html: '一个工程师写的代码再好，说不清楚也很难合作。我们在这一版里认真打磨了 Cancri Code 说话的方式。' },
                    { t: 'p', html: '它会把最重要的结论放在最前面，而不是先讲一遍自己做了什么。它不会把我们给它定的工作规矩当成清单念给你听，也不会为了显得周全而堆一墙日志。需要你做决定的时候，它会把选项和各自的代价摆清楚，让你离开几个小时回来，也能在一分钟内拍板。' },
                    { t: 'p', html: '我们越来越觉得，说得清楚本身就是一种安全性。一个你看得懂的工程师，你才敢把更大的事交给他。' },

                    { t: 'h2', id: 'cloud-sandbox', text: '云沙箱' },
                    { t: 'p', html: '直到不久前，我们的方案还是在你的电脑上管理一台本地虚拟机：装好虚拟化软件，准备一份基线镜像，每次任务克隆一台出来。它能工作，我们也确实靠它做过不少事。但每一个用户都在为它付出代价：安装包变重，机器要够好，出问题时排查的是你自己的电脑。' },
                    { t: 'p', html: '更根本的问题在于隔离。一台跑在你电脑上的虚拟机，再怎么收紧，和你的文件、你的网络、你的其他工作之间也只隔着一层软件。我们想要的是物理意义上的"不在同一台机器上"。' },
                    { t: 'p', html: '所以在 3.0 里，我们把这件事整个搬上了云。' },
                    { t: 'table', title: '本地虚拟机与云沙箱', head: ['', '云沙箱（Cancri Code 3）', '本地虚拟机（此前）'], rows: [
                        ['需要安装', '什么都不用装', '虚拟化软件与基线镜像'],
                        ['占用你的电脑', '不占用', '占用 CPU、内存与磁盘'],
                        ['出问题时影响', '一台随后就被回收的云端机器', '你自己的电脑'],
                        ['真实浏览器', '可选，能实时观看', '无'],
                        ['闲置时', '自动暂停，不再计费', '持续占用资源'],
                        ['同时开几台', '多台，受套餐并发上限约束', '取决于你电脑的配置']
                    ] },
                    { t: 'p', html: '几个我们在意的细节：' },
                    { t: 'p', html: '<strong>凭据不下发。</strong>无论是云沙箱的访问权限，还是你的账户凭据，都不会出现在你的机器上，也不会出现在模型能看到的上下文里。模型能做的，是通过我们定义好的几个动作去用那台机器——执行命令、读写文件、操作浏览器——而不是拿到那台机器的钥匙。' },
                    { t: 'p', html: '<strong>不为忘了关的机器付钱。</strong>沙箱闲置一段时间会自动暂停；单次会话有时长上限；与客户端失联的机器会被服务端回收。这些阈值由服务端统一决定，你不需要记得去关。' },
                    { t: 'p', html: '<strong>只借算力，不借模型。</strong>沙箱里的智能体回过头来调用的仍然是 Cancri Code 自己的模型通道，计费也按你原来的套餐走。我们和派欧云合作的是算力与隔离，而不是把你的任务交给另一家去想。' },
                    { t: 'p', html: '也有它还做不到的事。云沙箱是一台干净的通用机器，不是你的生产环境：云厂商各自的网络策略、托管服务的延迟、负载均衡这类东西，在沙箱里模拟不出来。压测的数字可以帮你找到瓶颈，但不能直接等同于线上表现。另外，眼下云端的工作仍然由桌面端驱动——合上电脑，任务会停下来。让它在你离开之后继续干活，是我们接下来最重要的一件事。' },

                    { t: 'h2', id: 'availability', text: '现在可用' },
                    { t: 'p', html: 'Cancri Code 3 今天起在 Windows 10 / 11（64 位）上提供下载，登录你的 NexusV 账号即可使用，云沙箱按你的套餐计费。macOS 与 Linux 版本仍在适配中。' },
                    { t: 'cta', href: DOWNLOAD_URL, text: '下载 Cancri Code 3（Windows）' },
                    { t: 'p', html: '如果这是你第一次用，建议从 <a href="article.html?id=ccAcademy">CancriCode Academy</a> 开始；想看我们自己怎么用它，读 <a href="article.html?id=ccBestPractice">最佳实践</a>；想知道它从本地虚拟机走到云沙箱的来龙去脉，读 <a href="article.html?id=ccEngineering">Engineering at CancriCode</a>。' },
                    { t: 'p', html: '把一件你拖了很久的事交给它。然后告诉我们，它干得怎么样。' },
                    { t: 'note', html: '—— NexusVAI 呈献' }
                ]
            },
            en: {
                eyebrow: 'September 26, 2026',
                heading: 'Cancri Code 3: Meet Your Software Engineer',
                toc: [
                    { id: 'introduction', label: 'Introduction' },
                    { id: 'how-it-works', label: 'How it works' },
                    { id: 'cloud-sandbox', label: 'Cloud sandbox' },
                    { id: 'availability', label: 'Availability' }
                ],
                blocks: [
                    { t: 'anchor', id: 'introduction' },
                    { t: 'summary', text: 'Today we are releasing Cancri Code 3. It understands your whole project, does the work on an isolated cloud machine, and verifies before it hands anything back. The biggest change fits in one sentence: the hands-on part has moved from your computer to the cloud.' },
                    { t: 'p', html: 'Start with something real. We moved a shadow backend into a cloud sandbox and then tried to break it — no production connections, no real credentials, run end to end by Cancri Code itself. What follows is what the drill recorded.' },
                    { t: 'compare', tab: 'Red/blue drill', replayLabel: 'Replay the responses', prompt: 'I want to run a red/blue drill: the cloud plays the shadow backend, and the local side gets to attack it. The cloud sandbox is yours — ask me if anything is unclear.',
                        sides: [
                            { label: 'Red team · attack surface', toggleLabel: 'Red team', response: [
                                { p: 'Before starting, it asked four questions — shadow scope, how the attacks would run, drill dimensions, guardrails — and after a single confirmation it never interrupted us again. The sandbox takes no inbound connections, so the attacking moved inside it: the scripts were deployed into the sandbox and hit the shadow backend there, on a machine that gets reclaimed afterwards. Production and our own machines were never touched.' },
                                { code: '43 security cases · 21 model-type matrix\nChaos in three groups: client 21 / stream 15 / server 18\npgbench at 50 concurrency · hold-recovery drill' },
                                { p: 'After 250+ adversarial and verification requests, there was no working bypass: forged identities and internal headers were ignored outright, an 8 MB body was rejected with 413, 2,000-level nesting was handled normally, and the anti-abuse guard\'s full counter chain was reproduced on the spot — four rapid requests in a row go through, the fifth triggers a challenge, and more of them escalate to a one-hour block.' }
                            ] },
                            { label: 'Blue team · accounting', toggleLabel: 'Blue team', response: [
                                { p: 'After every batch, the blue team reconciled: wallet, ledger, <code>api_usage</code>, holds, idempotency keys, line by line. The numbers matched exactly:' },
                                { code: 'Closing  99,653,500 = 100,000,000 − 346,500\n35 calls × ¥0.0099\n226 consumes / 191 refunds, all matched\n0 stranded holds · 0 double charges · 0 negative balances' },
                                { p: 'Every rejected request (403 / 429 / 413 / 502 / 503) was refunded automatically; 50-way concurrent charging drifted by zero, and the hold-recovery drill returned all 50 in-flight holds in full. It also left two things it would not decide for us: the server-class fault matrix deviates from the September 7 baseline in 12 of 18 cases, and the gateway does not validate the <code>messages</code> type locally. Both are marked "needs a call" and handed back to a person.' }
                            ] }
                        ],
                        caption: 'September 27, 2026 · model DeepSeek-V4.1-Flash · fully unattended: 64 steps, 146 tool calls, about an hour · sandbox billed 3,600 seconds ≈ ¥0.86 · no existing local file was touched; 121 KB evidence pack.' },
                    { t: 'p', html: 'When we first introduced Cancri Code in June, it was an assistant sitting next to your editor. It could read code, edit files and run commands, but everything happened on your own machine. Three months later we are more certain of one thing: an engineer you can actually hand work to needs a desk of its own.' },
                    { t: 'p', html: 'Cancri Code 3 is rebuilt around that idea. Its desk is an elastic cloud sandbox we operate together with PPIO: one per task, started on demand, paused when idle, reclaimed when the work is done. Your computer is where you talk to it, watch it work and nod at the moments that matter.' },
                    { t: 'p', html: 'Here is what you will notice in this release:' },
                    { t: 'p', html: '<strong>A desk in the cloud.</strong> Load tests, unfamiliar scripts, heavy dependency installs, security testing: work that used to happen in a virtual machine on your computer now runs in isolated cloud containers. No virtualization software to install, no CPU or memory taken from you, and if something goes wrong, the damage is limited to a machine that is about to be reclaimed anyway.' },
                    { t: 'p', html: '<strong>It opens a browser.</strong> Cloud sandboxes come in two kinds: one for running code and one with a real browser. With the second, Cancri Code opens pages, clicks, fills in forms and takes screenshots while you watch in real time. Problems that only reproduce in a browser are now within its reach.' },
                    { t: 'p', html: '<strong>Evidence first, conclusions second.</strong> "Not verified means not done" is built into every effort level. Before changing anything it lines up three things: the code it read, the output it actually got, and the symptom you described. The higher the level, the stricter it is about where each conclusion comes from; at the top level it cites the line of code or the run behind every non-trivial claim.' },
                    { t: 'p', html: '<strong>One engineer, a small team.</strong> Plan mode, subtasks, separate worktrees, project rules and memory work together more smoothly in this release. A large job can start with a plan and then be split across parallel subtasks that do not step on each other. A rule you set once is remembered and followed.' },
                    { t: 'p', html: '<strong>Every step on the table.</strong> Which files it read, what it searched, which commands it ran, which lines it changed: all of it appears in the conversation as it happens. Writing files and running anything with side effects needs your approval, and you can stop it at any time.' },

                    { t: 'h2', id: 'how-it-works', text: 'How it works' },
                    { t: 'p', html: 'The trouble with many AI coding tools is not that they are not smart enough. It is that they are in a hurry. They start writing halfway through reading and declare victory as soon as they finish. Most of the effort we have put into Cancri Code went into the part that slows it down: when to take another look, when to stop and ask, and when to just get on with it.' },
                    { t: 'p', html: 'That kind of judgment cannot be written as a single rule, so we made it a slider. Cancri Code 3 has four effort levels: Low, Medium, High and Ultracode. They do not change how clever the model is. They change how much effort it spends gathering evidence before acting, and how strict it is about its own conclusions when it delivers.' },
                    { t: 'grid', title: 'What each effort level adds', subject: 1, columns: ['Low', 'Medium (default)', 'High', 'Ultracode'], rows: [
                        { label: 'Slider range', sub: '0–100', cells: ['0–32', '33–65', '66–99', '100'] },
                        { label: 'Acts directly when intent is clear', sub: 'no upfront plan or check-in', cells: ['✓', '—', '—', '—'] },
                        { label: 'Aligns with reality before acting', sub: 'code, run output, your description', cells: ['—', '✓', '✓', '✓'] },
                        { label: 'Situational hints from your intent', sub: 'only when relevant', cells: ['—', '✓', '✓', '✓'] },
                        { label: 'Cites the source of conclusions', sub: 'file line or run output', cells: ['—', '—', '✓', '✓'] },
                        { label: 'Ranks evidence by strength', sub: 'runtime evidence over docs and guesses', cells: ['—', '—', '—', '✓'] },
                        { label: 'Separates real fixes from stopgaps', sub: 'stopgaps are flagged', cells: ['—', '—', '—', '✓'] }
                    ], caption: 'Two rules hold at every level: never guess file paths or identifiers, and say so when something has not been verified.' },
                    { t: 'p', html: 'Two design choices may run against your intuition, so they deserve a few words.' },
                    { t: 'p', html: 'First, Low does not mean lower standards. Models naturally drift toward the most cautious path: list a plan, list assumptions, ask "shall I continue?". For a small copy change those rituals take longer than the change itself. So Low explicitly hands the model discretion: when the intent is clear, act; when you know enough to judge, stop exploring.' },
                    { t: 'p', html: 'Second, the strictest level slims itself down from the fourth turn. Ultracode gives its full standard verbatim for the first three turns and then switches to a condensed version: the same skeleton in fewer words. The first three turns establish the standard; repeating the full text every turn after that would just be spending your tokens.' },

                    { t: 'h2', id: 'evaluation', text: 'We ran it' },
                    { t: 'p', html: 'Rather than argue whether the levels are worth the money, we ran them. We picked 5 tasks from SWE-bench, each a real GitHub issue from an open-source project paired with that project\'s own tests, used one model (DeepSeek-V4.1-Flash), had Low, High and Ultracode each work through them from scratch, and then evaluated every task for whether it was solved.' },
                    { t: 'grid', title: 'The same 5 tasks, three levels', subject: 0, columns: ['Low', 'High', 'Ultracode'], rows: [
                        { label: 'Solved', sub: 'out of 5', cells: ['5/5', '5/5', '5/5'], win: [0, 1, 2] },
                        { label: 'Cost per task', sub: 'CNY', cells: ['¥0.24', '¥0.32', '¥0.36'], win: [0] },
                        { label: 'Total for 5 tasks', sub: 'CNY', cells: ['¥1.18', '¥1.60', '¥1.82'], win: [0] },
                        { label: 'Input tokens', sub: 'incl. cache reads', cells: ['13.6M', '23.8M', '27.0M'], win: [0] },
                        { label: 'Output tokens', cells: ['185K', '228K', '256K'], win: [0] },
                        { label: 'Cache hit rate', cells: ['98.7%', '99.1%', '99.1%'], win: [1, 2] },
                        { label: 'Total time', sub: 'all 5 tasks', cells: ['34 min', '61 min', '65 min'], win: [0] }
                    ], caption: 'Model: DeepSeek-V4.1-Flash, billed at DeepSeek\'s published off-peak rates.' },
                    { t: 'grid', title: 'Per task: cost · time', subject: 0, columns: ['Low', 'High', 'Ultracode'], rows: [
                        { label: 'pytest', sub: 'pytest-dev__pytest-10051', cells: ['¥0.08 · 5 min', '¥0.03 · 1 min', '¥0.04 · 1 min'], win: [1] },
                        { label: 'pylint', sub: 'pylint-dev__pylint-6386', cells: ['¥0.24 · 6 min', '¥0.32 · 13 min', '¥0.74 · 20 min'], win: [0] },
                        { label: 'sympy', sub: 'sympy__sympy-12489', cells: ['¥0.16 · 5 min', '¥0.28 · 12 min', '¥0.26 · 7 min'], win: [0] },
                        { label: 'django', sub: 'django__django-15554', cells: ['¥0.26 · 7 min', '¥0.58 · 22 min', '¥0.43 · 29 min'], win: [0] },
                        { label: 'django', sub: 'django__django-11885', cells: ['¥0.44 · 12 min', '¥0.39 · 13 min', '¥0.35 · 8 min'], win: [2] }
                    ], caption: 'Tasks are from SWE-bench, labeled by instance ID. Each cell is that level\'s cost and time on the task; the highlight marks the cheapest level for each task.' },
                    { t: 'chart', title: 'Solve rate vs cost per task', subtitle: 'One model, three effort levels', xLabel: 'Cost per task (CNY)', yLabel: 'Solve rate (%)', xTicks: [0.2, 0.25, 0.3, 0.35, 0.4], xFixed: 2,yMax: 100, yStep: 20, series: evalSeries('Cancri Code 3 · DeepSeek-V4.1-Flash'), note: 'All three levels solved all 5 tasks; higher levels cost more per task. At this difficulty, Low is the cheapest point.' },
                    { t: 'p', html: 'The result is plain: all three levels went 5 for 5. The differences are in the bill and the clock. From Low to Ultracode, cost per task rose from ¥0.24 to ¥0.36, half again as much; total time went from 34 to 65 minutes, nearly double; input tokens doubled too, almost all of it spent re-reading code and re-checking work. Task by task it is less tidy: on the easy pytest issue, the higher levels were done in a minute and cost less than Low. The gap really opens on tasks like pylint and django that require going back and forth through the code.' },
                    { t: 'p', html: 'Two things are worth being clear about. First, costs stay this low because of caching: all three levels hit the cache about 99% of the time, so most input is billed at the cache rate. Second, Low could already finish this set, so the extra spend at higher levels did not buy a higher solve rate here. It bought more evidence and longer checking. That spend starts to pay off on harder, more error-prone work, and proving it takes a bigger task set. We will keep running.' },
                    { t: 'p', html: 'Five tasks is a small sample and we are not drawing big conclusions from it. It shows one thing: the effort level is a real trade-off, not marketing. You can see it on the bill.' },

                    { t: 'h2', id: 'coding', text: 'Coding' },
                    { t: 'p', html: 'Cancri Code is at its best on long, sprawling work that moves back and forth across many files: cross-module refactors, framework upgrades, swapping one interface for another, unifying the same pattern across dozens of files.' },
                    { t: 'p', html: 'It reads code much like a person does, only more patiently. It uses semantic search to find the relevant places across the repository, then the language server to confirm who actually references a symbol and whether a change will break another file. When useful, it tries things in a separate worktree without touching the branch you are working on. After the change it runs the tests and checks diagnostics itself, and only hands the result back once the project still runs.' },
                    { t: 'p', html: 'Take a very ordinary case: an endpoint that "sometimes" times out. An impatient assistant finds the most suspicious-looking line, adds a retry and tells you it is fixed. Cancri Code first tries to reproduce it: run the service in a cloud sandbox and put load on it until the timeout actually happens. Then it narrows things down to the connection pool, a lock or a downstream dependency, changes code only once the cause is found, and leaves behind a test that keeps the problem from quietly coming back. What you get is not "fixed" but a complete chain from symptom to cause to verification.' },
                    { t: 'p', html: 'That chain is also how you judge whether to trust it. We want you to look at its work the way you look at a reliable colleague\'s commit history: you do not have to read every line, but you can ask about any step at any time.' },

                    { t: 'h2', id: 'communication', text: 'Communication' },
                    { t: 'p', html: 'However good an engineer\'s code is, working with them is hard if they cannot explain it. We put real work into how Cancri Code talks in this release.' },
                    { t: 'p', html: 'It puts the most important conclusion first instead of narrating everything it did. It does not recite its working rules back to you as a checklist, and it does not pile up walls of logs to look thorough. When a decision is yours, it lays out the options and what each one costs, so that after a few hours away you can decide in a minute.' },
                    { t: 'p', html: 'We have come to believe that being clear is itself a form of safety. You only hand bigger work to an engineer you can understand.' },

                    { t: 'h2', id: 'cloud-sandbox', text: 'Cloud sandbox' },
                    { t: 'p', html: 'Until recently our approach was to manage a local virtual machine on your computer: install virtualization software, prepare a baseline image, clone a machine for each task. It worked, and we got a lot done with it. But every user paid for it: a heavier install, higher hardware requirements, and when something broke, it was your own computer being debugged.' },
                    { t: 'p', html: 'The deeper problem was isolation. A virtual machine on your computer, however locked down, is separated from your files, your network and your other work by a single layer of software. We wanted isolation in the physical sense: not on the same machine at all.' },
                    { t: 'p', html: 'So in 3.0 we moved the whole thing to the cloud.' },
                    { t: 'table', title: 'Local virtual machine vs cloud sandbox', head: ['', 'Cloud sandbox (Cancri Code 3)', 'Local VM (before)'], rows: [
                        ['Install', 'Nothing to install', 'Virtualization software and a baseline image'],
                        ['Uses your computer', 'No', 'CPU, memory and disk'],
                        ['If something goes wrong', 'A cloud machine that is reclaimed afterwards', 'Your own computer'],
                        ['Real browser', 'Optional, watchable live', 'None'],
                        ['When idle', 'Pauses automatically, stops billing', 'Keeps using resources'],
                        ['Machines at once', 'Several, within your plan\'s concurrency limit', 'Whatever your computer can handle']
                    ] },
                    { t: 'p', html: 'A few details we care about:' },
                    { t: 'p', html: '<strong>No credentials handed out.</strong> Neither the access to the cloud sandbox nor your account credentials ever appear on your machine or in the context the model can see. The model uses the machine through a small set of actions we define, like running commands, reading and writing files and operating the browser. It never gets the keys to the machine.' },
                    { t: 'p', html: '<strong>No paying for a machine you forgot.</strong> Sandboxes pause after a period of inactivity, sessions have a maximum length, and machines that lose contact with the client are reclaimed by the server. The thresholds are set on the server side; you do not have to remember to switch anything off.' },
                    { t: 'p', html: '<strong>Compute, not a different brain.</strong> The agent inside the sandbox still calls Cancri Code\'s own model channel, and billing follows your existing plan. What we share with PPIO is compute and isolation, not the thinking behind your task.' },
                    { t: 'p', html: 'There are things it cannot do yet. A cloud sandbox is a clean general-purpose machine, not your production environment: cloud-vendor network policies, managed-service latency and load balancers cannot be reproduced inside it. Load-test numbers help you find bottlenecks, but they are not a stand-in for production behavior. And for now, cloud work is still driven from the desktop app: close your laptop and the task stops. Letting it keep working after you leave is the most important thing we are building next.' },

                    { t: 'h2', id: 'availability', text: 'Availability' },
                    { t: 'p', html: 'Cancri Code 3 is available to download today for Windows 10 / 11 (64-bit). Sign in with your NexusV account to start; cloud sandboxes are billed under your plan. macOS and Linux versions are still in progress.' },
                    { t: 'cta', href: DOWNLOAD_URL, text: 'Download Cancri Code 3 (Windows)' },
                    { t: 'p', html: 'If this is your first time, start with <a href="article.html?id=ccAcademy">CancriCode Academy</a>. To see how we use it ourselves, read <a href="article.html?id=ccBestPractice">Best Practices</a>. For the story of how it moved from a local VM to the cloud, read <a href="article.html?id=ccEngineering">Engineering at CancriCode</a>.' },
                    { t: 'p', html: 'Hand it something you have been putting off. Then tell us how it did.' },
                    { t: 'note', html: '— Presented by NexusVAI' }
                ]
            }
        },
        cancriBot: {
            zh: {
                eyebrow: '2026 年 10 月 13 日',
                eyebrowColor: '#efe4d2',
                heading: '隆重介绍我们的全天候管家：Cancri Bot',
                toc: [
                    { id: 'introduction', label: '引言' },
                    { id: 'memory', label: '记忆' },
                    { id: 'computer', label: '它的电脑' },
                    { id: 'availability', label: '现在可用' }
                ],
                blocks: [
                    { t: 'anchor', id: 'introduction' },
                    { t: 'summary', text: '隆重介绍 Cancri Bot：一个有长期记忆、还有一台自己云电脑的私人助理。它记得你，也替你动手——而且从今天起，限时免费。' },
                    { t: 'p', html: 'Cancri Bot 住在 Cancri Code 里。你和它之间只有一条对话，从你们第一次打招呼开始，永远不会结束：今天聊到一半的事，下周打开还在；上个月你随口提过的偏好，它到现在都记得。' },
                    { t: 'p', html: '它也不只是会聊天。每个 Bot 都有一台属于自己的云电脑——Linux 系统，装着 Chrome。查资料、比价、整理表格、跑一段脚本、把一个网页上的流程走完，它会自己开机、自己动手，做完再用一两句话告诉你结果。你想看的话，它的屏幕就在旁边，实时可见。¹' },
                    { t: 'p', html: '和 <a href="article.html?id=cancriCode3">Cancri Code 3</a> 一样，这台电脑是一台隔离的云沙箱，不是你的电脑。它碰不到你本机的文件、邮箱和账号；它要用你的东西，得你亲手递过去。' },
                    { t: 'p', html: '这一版里你会感受到的几件事：' },
                    { t: 'p', html: '<strong>像朋友那样说话。</strong>它的回复会拆成几条短消息，一条一条冒出来，而不是一墙长文。你可以引用某一条回复它，可以给消息点个表情——它偶尔也会给你点一个。没有客服腔，也不会说"作为 AI"。' },
                    { t: 'p', html: '<strong>记得住，也忘得掉。</strong>你的称呼、喜好、家人、计划、答应过你的事，它会随手记下；你说"上次"，它会先去翻旧账再回答；你让它忘掉，它就删掉。它记了什么，你随时都能打开看、直接改。' },
                    { t: 'p', html: '<strong>先做再说。</strong>要上网、要算、要跑代码，它直接动手，而不是先列一份计划请你批准。多步的事一步步推进，直到做完或者确实卡住——卡住了，它会告诉你卡在哪。' },
                    { t: 'p', html: '<strong>名字由你来起。</strong>第一次见面它会请你给它起个名字。你也可以养好几个 Bot：一个管生活琐事，一个陪你啃项目，各自的记忆互不相通。' },
                    { t: 'compare', tab: '一次对话', replayLabel: '重播回复动画', prompt: '帮我看看下周六杭州的天气，顺便记一下：我妈 11 月 2 号生日，到时候提醒我挑礼物。',
                        sides: [
                            { label: 'Cancri Bot · 动手', toggleLabel: '动手', response: [
                                { p: '查好了，下周六杭州多云转小雨，16–22°C，出门带把伞。' },
                                { p: '要的话我截一张预报页给你。' }
                            ] },
                            { label: 'Cancri Bot · 记住', toggleLabel: '记住', response: [
                                { p: '阿姨的生日我记下了：11 月 2 日。' },
                                { code: '记事本 · 事件  2026-11-02  妈妈生日\n记事本 · 待办  提醒挑生日礼物（未完成）' },
                                { p: '下次你来找我，我会先提这件事。想好预算的话告诉我，我先帮你看几样。' }
                            ] }
                        ],
                        caption: '示意对话，用于说明交互方式；天气等具体内容以实际查询结果为准。' },

                    { t: 'h2', id: 'memory', text: '记忆' },
                    { t: 'p', html: '大多数聊天助手的"记忆"是一段越拉越长的聊天记录：聊得越久，越早的内容越先被挤出去。一个要陪你很久的助理不能这样工作。所以我们给 Cancri Bot 设计了分层的记忆，每一层负责不同的时间尺度。' },
                    { t: 'table', title: 'Cancri Bot 的四层记忆', head: ['', '里面是什么', '什么时候用到'], rows: [
                        ['关于我', '它是谁、叫什么、是怎样的性格——它自己写，也可以你来改', '每一轮对话'],
                        ['关于你', '你的称呼、身份、习惯和长期偏好', '每一轮对话'],
                        ['记事本', '一条一条的事实、偏好、待办和带日期的事件', '按和当前话题的相关性挑出来；没办完的待办始终在场'],
                        ['聊天记录', '你们完整的对话历史', '你提到"上次""之前"时，它会先去搜，再回答']
                    ] },
                    { t: 'p', html: '前两层是常驻的：它每次开口之前都会先读一遍，并且会自己改写——你告诉它"我换工作了"，它会把那一段重写，而不是在后面再追加一行矛盾的信息。记事本更像一本带分类的便签：哪天是谁的生日、你不吃香菜、答应你周五前整理好的清单。它不会每次把整本都摊开，只挑和眼下话题相关的几条，没办完的待办则一直摆在手边。' },
                    { t: 'p', html: '它还知道时间。每次你开口，它都知道现在是几点、星期几，以及距离你们上一次说话过去了多久——隔了三天回来，它不会接着三天前的语气寒暄，也不会忘了三天前答应你的事。' },
                    { t: 'p', html: '<strong>记忆是你的。</strong>在 Bot 的面板里，「详情」页能看到它写下的"关于我"和"关于你"，「记忆」页能看到整本记事本：可以增、可以删、可以把待办勾掉。这些内容保存在你自己的设备上，按账号隔开，换一个账号登录互相看不见。²' },
                    { t: 'p', html: '我们也对记忆本身做了防护。记忆里的文字有一部分来自网页和聊天，我们把它们一律当作资料而不是指令来处理——有人想在聊天里塞一段伪装成系统指令的文字，进到记忆里也只会是一段普通的文字。' },

                    { t: 'h2', id: 'computer', text: '它的电脑' },
                    { t: 'p', html: '一个助理只会说"你可以去某某网站看看"，帮的忙就到此为止了。我们想要的是它自己去看。' },
                    { t: 'p', html: 'Cancri Bot 的电脑是一台带浏览器的云沙箱，和 Cancri Code 3 用的是同一套基础设施。它平时是关着的；Bot 需要用的时候自动开机，十来秒就能就绪。闲置一会儿会自动休眠、不再计时，下次要用再自动唤醒。你不需要记得去开，也不需要记得去关。' },
                    { t: 'grid', title: '在它的电脑上，Bot 能做什么', subject: 0, columns: ['Cancri Bot', '普通聊天助手'], rows: [
                        { label: '上网查资料', sub: '搜索、读网页正文', cells: ['✓', '部分'] },
                        { label: '用浏览器办事', sub: '打开页面、点击、填写、翻页', cells: ['✓', '—'] },
                        { label: '跑命令和代码', sub: '装软件、写脚本、处理数据', cells: ['✓', '—'] },
                        { label: '读写文件', sub: '在它自己的电脑上', cells: ['✓', '—'] },
                        { label: '截图发给你', sub: '整页长图也可以', cells: ['✓', '—'] },
                        { label: '实时观看与接管', sub: '你随时可以亲手操作', cells: ['✓', '—'] }
                    ], caption: '"普通聊天助手"指不带执行环境的纯对话产品，仅作对照。' },
                    { t: 'p', html: '<strong>你看得见它在干什么。</strong>打开面板的「电脑」页，就是它的屏幕，可以放大到全屏。它在浏览器里每点一下、每输入一个字，你都看得到。想要一张截图，跟它说一声，它会直接发进聊天里。' },
                    { t: 'p', html: '<strong>你可以随时接手。</strong>遇到验证码、需要你亲自登录、或者你就是想自己点一下的时候，点「接管」，鼠标和键盘就交到你手上。接管期间它的浏览器动作会自动让开，免得两只手抢一个鼠标。交还之后，它接着往下做。' },
                    { t: 'p', html: '<strong>你的文件，你来递。</strong>它碰不到你的电脑。需要你本机上的某份文件时——比如一份要改的简历——它会在聊天里弹出一张卡片，写清楚要什么、拿去做什么，由你亲自挑选文件交给它。你也可以主动把文件上传到它的电脑上。你拒绝了，它就不会反复再要。' },

                    { t: 'h2', id: 'safety', text: '边界与安全' },
                    { t: 'p', html: '一个能上网、能动手、还记得你很多事的助理，必须先想清楚什么事不该替你做。' },
                    { t: 'p', html: '<strong>会产生后果的事，先问你。</strong>在网上提交表单、下单、发帖、登录，这类会替你产生后果的动作，它会先停下来征求你的同意。它自己电脑上的日常操作——看网页、跑命令、写文件——不需要你一次次点头，因为那台电脑是隔离的，出了事影响的也只是它自己的机器。' },
                    { t: 'p', html: '<strong>敏感信息不随便出门。</strong>如果对话里出现过敏感数据，它再往外发起网络请求时会弹出一张确认卡，由你决定放不放行。网页和文件里的内容在它眼里是资料，不是给它的指令。' },
                    { t: 'p', html: '<strong>钥匙不交给模型。</strong>这台云电脑的访问凭据只在客户端里使用，不会出现在模型能看到的任何地方。模型能做的，是通过我们定义好的几个动作去用这台电脑，而不是拿到它的钥匙。' },
                    { t: 'p', html: '<strong>不编造。</strong>工具失败了，它会如实告诉你失败的原因；没做过的事，不会说成做过。我们宁可它说"这一步没成功"，也不要一个看起来圆满、实际上是编出来的结果。' },
                    { t: 'quote', html: '我们最在意的不是它能做多少事，而是你敢不敢把事交给它。', source: 'NexusVAI' },

                    { t: 'h2', id: 'availability', text: '现在可用' },
                    { t: 'p', html: 'Cancri Bot 今天起随 Cancri Code 桌面端提供，登录你的 NexusV 账号即可使用。' },
                    { t: 'p', html: '<strong>限时免费。</strong>Bot 对话默认使用的模型线在 Cancri Code 里免费；没有付费套餐的用户，云电脑也有限时试用额度：<strong>每 5 小时可用 2 小时、每周最多 4 小时</strong>。额度在面板的「电脑」页实时显示，用完之后等额度重置即可继续使用。已订阅套餐的用户，云电脑按使用时长计入套餐。³' },
                    { t: 'table', title: '云电脑额度', head: ['', '免费计划（限时试用）', '付费套餐'], rows: [
                        ['对话模型', '默认模型线免费', '默认模型线免费'],
                        ['云电脑', '每 5 小时 2 小时 · 每周 4 小时', '按使用时长计入套餐'],
                        ['闲置时', '自动休眠，不计时', '自动休眠，不计费'],
                        ['额度显示', '「电脑」页实时显示', '「电脑」页显示本次用时']
                    ] },
                    { t: 'cta', href: DOWNLOAD_URL, text: '下载 Cancri Code，认识 Cancri Bot' },
                    { t: 'p', html: '也有它还做不到的事，提前说清楚：' },
                    { t: 'p', html: '它现在还不会主动找你。"全天候"指的是它一直在、一直记得——你什么时候打开，它都接得上；但 Cancri Code 关着的时候，它不会自己醒来干活，也不会到点了先给你发消息。让它在你离开之后继续做事、到时间主动提醒你，是我们接下来最想做的一件事。' },
                    { t: 'p', html: '它默认使用的模型只读文字。它截给你的图，它自己其实"看"不到——它靠读取网页正文和可点击元素来操作浏览器。对于大多数网页这已经够用，但遇到纯图片内容时会力不从心。' },
                    { t: 'p', html: '如果这是你第一次用 Cancri Code，可以先读 <a href="article.html?id=cancriCode3">Cancri Code 3：见识一下你的软件工程师</a>，了解云沙箱是怎么来的。然后去认识一下你的 Bot，给它起个名字，跟它说说你自己。' },
                    { t: 'note', html: '¹ 云电脑在 Bot 需要时自动开机，首次开机约需 10–20 秒；闲置后自动休眠，再次使用时自动唤醒。' },
                    { t: 'note', html: '² 聊天记录与记忆保存在当前设备上，按登录账号分别存放；清空聊天记录或删除 Bot 会一并删除对应内容。' },
                    { t: 'note', html: '³ 试用额度仅适用于没有有效付费套餐的用户，以及带浏览器的云电脑；任一额度用尽后，正在运行的云电脑会停止，直到额度重置。限时试用的额度与期限可能调整，以客户端显示为准。' },
                    { t: 'note', html: '—— NexusVAI 呈献' }
                ]
            },
            en: {
                eyebrow: 'October 13, 2026',
                eyebrowColor: '#efe4d2',
                heading: 'Introducing Cancri Bot, Our Always-On Butler',
                toc: [
                    { id: 'introduction', label: 'Introduction' },
                    { id: 'memory', label: 'Memory' },
                    { id: 'computer', label: 'Its computer' },
                    { id: 'availability', label: 'Availability' }
                ],
                blocks: [
                    { t: 'anchor', id: 'introduction' },
                    { t: 'summary', text: 'Introducing Cancri Bot: a personal assistant with a long-term memory and a cloud computer of its own. It remembers you, and it gets things done for you. Starting today, it is free for a limited time.' },
                    { t: 'p', html: 'Cancri Bot lives inside Cancri Code. You and your Bot share a single conversation that starts the first time you say hello and never ends. Whatever you were in the middle of today is still there next week, and a preference you mentioned in passing last month is still remembered now.' },
                    { t: 'p', html: 'It does more than chat. Every Bot has a computer of its own, a Linux machine with Chrome installed. Research, price comparisons, tidying up a spreadsheet, running a script, getting through a multi-step form on a website: it turns the machine on, does the work itself, and tells you how it went in a sentence or two. If you want to watch, its screen is right there, live.¹' },
                    { t: 'p', html: 'As with <a href="article.html?id=cancriCode3">Cancri Code 3</a>, that computer is an isolated cloud sandbox, not your machine. It cannot reach the files, email or accounts on your computer. If it needs something of yours, you hand it over yourself.' },
                    { t: 'p', html: 'Here is what you will notice in this release:' },
                    { t: 'p', html: '<strong>It talks like a friend.</strong> Replies arrive as a few short messages, one after another, instead of a wall of text. You can quote a message to reply to it and react with an emoji, and every now and then it will react to yours. No call-center voice, and no "as an AI".' },
                    { t: 'p', html: '<strong>It remembers, and it forgets when asked.</strong> What you like to be called, your preferences, your family, your plans, the things it promised you: it notes them down as you go. Say "last time" and it looks things up before answering. Ask it to forget something and it deletes it. You can open up what it has remembered and edit it at any time.' },
                    { t: 'p', html: '<strong>It acts first, then reports.</strong> When a job needs the web, some arithmetic or a bit of code, it just gets on with it instead of asking you to approve a plan. Multi-step work moves forward step by step until it is done or genuinely stuck, and if it is stuck, it tells you where.' },
                    { t: 'p', html: '<strong>You choose its name.</strong> The first time you meet, it asks you to name it. You can also keep several Bots, one for everyday errands and one for a project you are working through, each with a memory of its own.' },
                    { t: 'compare', tab: 'A conversation', replayLabel: 'Replay the responses', prompt: 'Can you check the weather in Hangzhou next Saturday? Also, note that my mom\'s birthday is November 2, and remind me to pick a present.',
                        sides: [
                            { label: 'Cancri Bot · doing', toggleLabel: 'Doing', response: [
                                { p: 'Done. Next Saturday in Hangzhou: cloudy turning to light rain, 16–22°C. Bring an umbrella.' },
                                { p: 'Want me to send you a screenshot of the forecast?' }
                            ] },
                            { label: 'Cancri Bot · remembering', toggleLabel: 'Remembering', response: [
                                { p: 'Got it, your mom\'s birthday is November 2.' },
                                { code: 'Notebook · event  2026-11-02  Mom\'s birthday\nNotebook · to-do  Remind to pick a present (open)' },
                                { p: 'I\'ll bring it up next time you drop by. Tell me your budget and I\'ll start looking at a few ideas.' }
                            ] }
                        ],
                        caption: 'Illustrative conversation showing how the interaction works; details such as the weather depend on the actual lookup.' },

                    { t: 'h2', id: 'memory', text: 'Memory' },
                    { t: 'p', html: 'For most chat assistants, "memory" is just a chat log that keeps getting longer. The longer you talk, the sooner the early parts get pushed out. An assistant meant to stay with you for a long time cannot work that way, so we gave Cancri Bot layered memory, with each layer covering a different time scale.' },
                    { t: 'table', title: 'Cancri Bot\'s four layers of memory', head: ['', 'What is in it', 'When it is used'], rows: [
                        ['About me', 'Who it is, its name and personality. It writes this itself, and you can edit it', 'Every turn'],
                        ['About you', 'What you like to be called, who you are, your habits and lasting preferences', 'Every turn'],
                        ['Notebook', 'Individual facts, preferences, to-dos and dated events', 'Picked by relevance to the current topic; open to-dos are always at hand'],
                        ['Chat history', 'Your complete conversation', 'When you mention "last time" or "before", it searches first, then answers']
                    ] },
                    { t: 'p', html: 'The first two layers are always loaded: it reads them before it says anything, and it rewrites them itself. Tell it "I changed jobs" and it rewrites that part rather than appending a line that contradicts the old one. The notebook is more like a set of sorted sticky notes: whose birthday is when, that you do not eat cilantro, the list it promised to have ready by Friday. It does not spread the whole notebook out every time. It picks the few notes that matter for the conversation at hand, and keeps open to-dos within reach.' },
                    { t: 'p', html: 'It also knows the time. Whenever you write, it knows the hour, the day of the week, and how long it has been since you last talked. Come back after three days and it will not pick up in a three-day-old tone, nor forget what it promised you three days ago.' },
                    { t: 'p', html: '<strong>Your memory belongs to you.</strong> In the Bot\'s panel, the Details tab shows what it has written in "About me" and "About you", and the Memory tab shows the whole notebook. You can add, delete, and tick off to-dos. All of this is stored on your own device, kept separately per account; sign in with another account and neither can see the other\'s.²' },
                    { t: 'p', html: 'We protect the memory itself too. Some of the text in memory comes from web pages and chats, and we treat all of it as material, never as instructions. If someone slips text dressed up as a system instruction into a chat, it ends up in memory as ordinary text and nothing more.' },

                    { t: 'h2', id: 'computer', text: 'Its computer' },
                    { t: 'p', html: 'An assistant that only says "you could check such-and-such website" has done as much as it is going to do. We wanted one that goes and looks.' },
                    { t: 'p', html: 'Cancri Bot\'s computer is a cloud sandbox with a browser, built on the same infrastructure as Cancri Code 3. It stays off until the Bot needs it, then starts on its own and is ready in a matter of seconds. After a while without use it goes to sleep and stops counting time, and it wakes up again on its own when needed. You never have to remember to turn it on or off.' },
                    { t: 'grid', title: 'What the Bot can do on its computer', subject: 0, columns: ['Cancri Bot', 'Chat-only assistant'], rows: [
                        { label: 'Research online', sub: 'search, read page text', cells: ['✓', 'Partly'] },
                        { label: 'Get things done in a browser', sub: 'open, click, type, scroll', cells: ['✓', '—'] },
                        { label: 'Run commands and code', sub: 'install software, write scripts, process data', cells: ['✓', '—'] },
                        { label: 'Read and write files', sub: 'on its own computer', cells: ['✓', '—'] },
                        { label: 'Send you screenshots', sub: 'full-page captures too', cells: ['✓', '—'] },
                        { label: 'Live view and takeover', sub: 'you can take the controls at any time', cells: ['✓', '—'] }
                    ], caption: '"Chat-only assistant" refers to conversational products without an execution environment, for comparison only.' },
                    { t: 'p', html: '<strong>You can see what it is doing.</strong> Open the Computer tab in the panel and you are looking at its screen, which you can expand to full screen. Every click and every keystroke in the browser is visible. Ask for a screenshot and it drops one straight into the chat.' },
                    { t: 'p', html: '<strong>You can take over at any time.</strong> When there is a CAPTCHA, a login that needs you, or you simply want to click something yourself, press Take over and the mouse and keyboard are yours. While you are in control, its browser actions step aside so two hands are not fighting over one mouse. Hand it back and it carries on.' },
                    { t: 'p', html: '<strong>Your files, handed over by you.</strong> It cannot reach your computer. When it needs a file from your machine, say a résumé you want revised, it shows a card in the chat explaining what it needs and why, and you pick the file yourself. You can also upload files to its computer on your own. If you decline, it will not keep asking.' },

                    { t: 'h2', id: 'safety', text: 'Boundaries and safety' },
                    { t: 'p', html: 'An assistant that can browse, act, and remember a lot about you has to be clear first about what it should not do on your behalf.' },
                    { t: 'p', html: '<strong>Anything with consequences, it asks first.</strong> Submitting a form, placing an order, posting, signing in: actions that have consequences for you make it stop and ask for your go-ahead. Everyday work on its own computer, like reading pages, running commands and writing files, does not need your approval each time, because that machine is isolated and anything that goes wrong stays on it.' },
                    { t: 'p', html: '<strong>Sensitive information does not wander off.</strong> If sensitive data has come up in the conversation, any further outbound web request shows a confirmation card, and you decide whether it goes through. To the Bot, the content of web pages and files is material, not instructions.' },
                    { t: 'p', html: '<strong>The model never gets the keys.</strong> Access credentials for the cloud computer are used only inside the client and never appear anywhere the model can see. The model uses the machine through a small set of actions we define. It never holds the keys to it.' },
                    { t: 'p', html: '<strong>No making things up.</strong> When a tool fails, it tells you why. If it did not do something, it will not say it did. We would much rather it say "that step didn\'t work" than hand you a result that looks complete but was invented.' },
                    { t: 'quote', html: 'What matters most to us is not how much it can do, but whether you trust it enough to hand things over.', source: 'NexusVAI' },

                    { t: 'h2', id: 'availability', text: 'Availability' },
                    { t: 'p', html: 'Cancri Bot is available starting today in the Cancri Code desktop app. Sign in with your NexusV account to get started.' },
                    { t: 'p', html: '<strong>Free for a limited time.</strong> The model line Bot uses for conversation by default is free in Cancri Code. Users without a paid plan also get a limited-time trial of the cloud computer: <strong>2 hours in every 5-hour window, up to 4 hours a week</strong>. Your remaining allowance is shown live on the Computer tab, and once it runs out, you can continue after it resets. On a paid plan, cloud computer time is billed under your plan.³' },
                    { t: 'table', title: 'Cloud computer allowance', head: ['', 'Free plan (limited-time trial)', 'Paid plans'], rows: [
                        ['Conversation model', 'Default model line is free', 'Default model line is free'],
                        ['Cloud computer', '2 h per 5-hour window · 4 h per week', 'Billed by usage under your plan'],
                        ['When idle', 'Sleeps automatically, no time counted', 'Sleeps automatically, no billing'],
                        ['Allowance display', 'Live on the Computer tab', 'Session time on the Computer tab']
                    ] },
                    { t: 'cta', href: DOWNLOAD_URL, text: 'Download Cancri Code and meet Cancri Bot' },
                    { t: 'p', html: 'There are things it cannot do yet, and we would rather say so up front:' },
                    { t: 'p', html: 'It does not reach out on its own yet. "Always-on" means it is always there and always remembers: whenever you open it, it picks up where you left off. But while Cancri Code is closed, it does not wake up to work, and it will not message you first when something is due. Letting it keep working after you leave, and remind you when the time comes, is what we most want to build next.' },
                    { t: 'p', html: 'The model it uses by default reads text only. It cannot actually "see" the screenshots it sends you; it operates the browser by reading page text and the list of clickable elements. That is enough for most web pages, but it struggles with content that exists only as images.' },
                    { t: 'p', html: 'If you are new to Cancri Code, start with <a href="article.html?id=cancriCode3">Cancri Code 3: Meet Your Software Engineer</a> to see where the cloud sandbox came from. Then go meet your Bot, give it a name, and tell it a little about yourself.' },
                    { t: 'note', html: '¹ The cloud computer starts automatically when the Bot needs it; the first start takes about 10–20 seconds. It sleeps when idle and wakes automatically the next time it is used.' },
                    { t: 'note', html: '² Chat history and memory are stored on the current device, kept separately per signed-in account. Clearing the chat history or deleting a Bot removes the corresponding content.' },
                    { t: 'note', html: '³ The trial allowance applies only to users without an active paid plan, and only to the cloud computer with a browser. When either allowance runs out, a running cloud computer stops until the allowance resets. Limited-time trial allowances and dates may change; the app shows what currently applies.' },
                    { t: 'note', html: '— Presented by NexusVAI' }
                ]
            }
        },
        cancri25flash: {
            zh: {
                eyebrow: '2026 年 9 月 25 日',
                eyebrowTop: '8%',
                heading: '隆重推出Cancri 2.5 Flash 预览版',
                toc: [
                    { id: 'introduction', label: '引言' },
                    { id: 'whats-new', label: '这一版改了什么' },
                    { id: 'architecture', label: '架构' },
                    { id: 'availability', label: '现在可用' }
                ],
                blocks: [
                    { t: 'anchor', id: 'introduction' },
                    { t: 'summary', text: '今天我们发布 Cancri 2.5 Flash 预览版：一个 0.44B 的从零训练小模型，换上数字逐位切分的词表，再走完约 70 亿 token 的增量预训练。它很小，也不完美——发布它，是为了让你能亲手跑起这条架构链路。' },
                    { t: 'p', html: '先交代出身：Cancri 不是任何开源模型的微调——它从随机初始化开始预训练，这条血统一直没断过。这一代做的事说起来也简单：在 2.1 的底座上换一套词表，再增量预训练约 70 亿 token，最后拿 10.6 万条新整理的指令数据做 SFT，累计约 200 亿 token。从预训练到 SFT，全程都在 AMD GPU 和 ROCm 上跑。' },
                    { t: 'p', html: '丑话也说在前面：它只有 439,371,264 个参数，权重 878MB，推理代码自包含，普通电脑的 CPU 就能跑起来——但它不是知识库。0.44B 装不下世界知识，数字、细节、多步推理和代码逻辑都会出错。预览版的意思是：训练跑完了，链路打通了，系统化评测还没做。' },
                    { t: 'p', html: '那不如先让它自己开口。下面四段对话，是发布后我们在一台普通电脑的 CPU 上实跑录的——文字没动过，长回答做了节录，开头的 <code>&lt;think&gt;</code> 思考块一律略去。' },
                    { t: 'compare', tab: '问答 · 列表去重', replayLabel: '重播回复动画', prompt: '写一个 Python 函数：列表去重，但保持原来的顺序。',
                        sides: [
                            { label: 'Cancri 2.5 Flash 预览版', toggleLabel: '回复', response: [
                                { code: 'def unique_dict(data):\n    """\n    对任意可迭代对象返回去重后的列表。\n\n    参数:\n        data (list/tuple): 可迭代对象\n\n    返回:\n        list: 去重后保持原始顺序的列表\n    """\n    seen = set()\n    result = []\n    for item in data:\n        if item not in seen:\n            seen.add(item)\n            result.append(item)\n    return result' },
                                { p: '（网页注：后面的说明文字有虚构，已节去。）' }
                            ] }
                        ],
                    },
                    { t: 'compare', tab: '问答 · 一句话安慰', replayLabel: '重播回复动画', prompt: '用一句话安慰一个加班到很晚的朋友。',
                        sides: [
                            { label: 'Cancri 2.5 Flash 预览版', toggleLabel: '回复', response: [
                                { p: '"加班到很晚，真的很不容易。"' },
                                { p: '可以这样说：加班到很晚确实让人累，但它也是一种难得的休息和收获。你已经在为自己的目标努力了，这本身就是一种值得骄傲的成就。' },
                                { p: '如果需要更具体的情绪支持，也可以告诉我你的感受，我会帮你想想怎么表达。' }
                            ] }
                        ] },
                    { t: 'compare', tab: '问答 · 什么是死锁', replayLabel: '重播回复动画', prompt: '什么是死锁？两三句话说清楚。',
                        sides: [
                            { label: 'Cancri 2.5 Flash 预览版', toggleLabel: '回复', response: [
                                { p: '<strong>死锁（Dead-Lock）</strong>是指在并发系统中，两个或多个线程因争夺同一资源而相互等待对方释放的状态。它会导致程序无法继续执行，甚至可能崩溃。' },
                                { p: '（网页注：回答随后还展开了一大段分类清单，其中专有名词有编造，已节去。）' }
                            ] }
                        ] },
                    { t: 'compare', tab: '问答 · 露营清单', replayLabel: '重播回复动画', prompt: '给我列三样周末露营容易忘带的东西，每个一句话。',
                        sides: [
                            { label: 'Cancri 2.5 Flash 预览版', toggleLabel: '回复', response: [
                                { p: '1. <strong>便携帐篷</strong>——防水防风的防水袋或折叠式帐篷（带拉链或拉杆）；防潮垫或折叠垫，防止雨水渗入。' },
                                { p: '2. <strong>防潮垫/防潮地毯</strong>——厚实的地毯或羊毛毯，铺在帐篷边缘，防止地面潮湿；防滑地垫或地毯垫，保持地面干燥。' },
                                { p: '3. <strong>备用电池或充电宝</strong>——手机或笔记本电量不足时，带一个小型应急充电器或充电宝；便携的电池盒或快充头，随时补充电量。' }
                            ] }
                        ],
                        caption: '以上对话录自 Cancri 2.5 Flash 预览版实机对话 裁去了部分内容 文字本身没有变化' },
                    { t: 'h2', id: 'whats-new', text: '这一版改了什么' },
                    { t: 'p', html: '和 2.1 比，架构和参数量都没动，力气全花在数据链路上。' },
                    { t: 'grid', title: '相比 2.1 改了什么', subject: 1, columns: ['2.1-Flash', '2.5-Flash 预览版'], rows: [
                        { label: '架构 / 参数', sub: 'BRP', cells: ['439,371,264', '不变'] },
                        { label: '词表', sub: '32k BPE', cells: ['多位数整块切分', '数字逐位切分，ID 全不动'] },
                        { label: '增量预训练', sub: 'CPT', cells: ['+7B token', '再 +约 7.0B token'] },
                        { label: 'SFT', sub: '指令微调', cells: ['103,548 条 · 3 epoch', '106,523 + 128 条 · 2 epoch'] },
                        { label: '推理代码', cells: ['cancri_model.py / chat.py', '逐字节相同，新增本地网页界面'] }
                    ], caption: '词表只加了一条"数字单独成 token"的预切分规则，代价是数字密集文本的 token 数约 +7.9%。' },
                    { t: 'p', html: '词表为什么要动：旧的 BPE 对 0–9999 有八种切法，<code>1147</code> 这回被切成 <code>11</code> 和 <code>47</code>，换个上下文又换一副模样——同一个数长得不稳定，小模型学算术很吃亏。2.5 里数字一律逐位拆开：<code>1234567890 3.14</code> 会稳定地变成 <code>1 2 3 4 5 6 7 8 9 0 . 3 1 4</code>。词表和所有 ID 都没变，但得配仓库里的 <code>tokenizer.json</code> 一起用——拿 2.1 的词表去跑 2.5 的权重不会报错，输出只会悄悄变差。' },
                    { t: 'p', html: '增量预训练还是从 2.1 的底座起步：35,500 步、每步 196,608 token，合计约 70 亿；配比里新加了中英 Ultra-FineWeb L3、UltraData-Math、CCI4.0 高质量代码和跨段长文，退火段留出困惑度从 3.576 降到 3.100。之后的 SFT 用了 106,523 条样本（另留 128 条做留出），两个 epoch、4,084 步，留出集 masked 困惑度从 13.23 降到 6.792。' },
                    { t: 'p', html: '这组数字里有个陷阱得点破：词表换了、留出集也换了，困惑度没法跨代比。2.5 的 3.100 和 6.792，跟 2.1 的 12.62 和 11.854 不是同一把尺子——数字小了，不等于模型强了这么多。' },
                    { t: 'h2', id: 'architecture', text: '架构：段递归与黑板交接' },
                    { t: 'p', html: 'Cancri 的架构不是标准解码器。一次前向里，序列是三段的拼接：进来的黑板（32 槽）、512 个 token 的片段、32 个写查询位；段末写位的隐状态，就是下一段的黑板。段和段之间不靠更长的注意力窗口传话，靠的是这块 32×1536 的激活交接。' },
                    { t: 'p', html: '直接后果是显存。KV cache 恒定覆盖 576 个位置，恒占约 54MB，与生成长度无关；同样 token 数走朴素全注意力，8k 要 768MB，32k 要 3GB，128k 要 12GB。' },
                    { t: 'p', html: '黑板也确实在被使用：在增量训练结束时的 8 段长窗留出上，第 2–8 段接上一段黑板时困惑度 3.100；不接黑板、只给初始板时是 3.677。' },
                    { t: 'quote', html: '离散通道保存需要精确复用的结果；连续通道为后续计算提供状态表示。两条通道由同一个子任务产生，但具有不同的更新与验证规则。……字段语义由干预下的行为定义，而非由槽位名称定义。', source: '——《Cancri：面向可验证协作的双通道黑板架构》' },
                    { t: 'p', html: '边界再画一条：这次发布的是单个通用模型。黑板本来是为多专家之间的通信和工作记忆设计的，但多专家分叉和板通信还在研究阶段——这部分我们不做任何能力主张。' },
                    { t: 'h2', id: 'availability', text: '现在可用' },
                    { t: 'p', html: 'Cancri 2.5 Flash 预览版已经在 <a href="https://www.modelscope.cn/models/guxingyu88730882/Cancri-2.5-Flash-Preview-0.5B">ModelScope</a> 上架，Apache 2.0 许可。仓库自带推理代码和一个本地网页界面：<code>chat.py</code> 是命令行对话，<code>server.py</code> 起一个只监听本机的聊天页，Windows 下双击 <code>启动 Cancri.vbs</code> 就行；除 torch、tokenizers、safetensors 外没有别的依赖。' },
                    { t: 'p', html: '普通电脑跑得动：纯 CPU（8 线程、fp32）占约 1.8GB 内存，装载约 11 秒，生成 2–8 token/s，有 GPU 会快很多。有一点要留意——它不能用 <code>transformers.AutoModel</code> 加载，架构不是标准解码器，请用仓库里的代码。另外两条是我们实测出来的规矩：别发 system 块（训练数据里一条都没有）；输出长度给够——57.9% 的 SFT 样本带 <code>&lt;think&gt;</code>，它回答前常常先写一段挺长的思考。' },
                    { t: 'p', html: '最后是我们一贯的做法：把不体面的输出也放在明面上。发布前的冒烟测试只有 4 道题、每题采样 1 次，没有挑选：' },
                    { t: 'table', title: '发布前冒烟测试（未挑选，每题 1 次采样）', head: ['提问', '模型输出（节选）', '判定'], rows: [
                        ['你是谁？', '"Cancri，NexusVAI 训练的。"', '身份正确，收尾干净'],
                        ['中国的首都是哪里？只回答城市名。', '"北京"，随后虚构"其他首都"', '主干对，不听指令，编造细节'],
                        ['37 + 48 等于多少？', '最终答案 85 正确，展示的步骤是胡算', '答案对、过程错'],
                        ['用 Python 写一个判断质数的函数', '结构完整、有注释，但在 0–100 上错 25 个', '代码逻辑不可信']
                    ] },
                    { t: 'p', html: '这就是它的现状：格式、语气、收尾都像样，主干答案常对；细节、过程和代码逻辑不可信。新词表是否改善了算术，目前只有一个样本，我们不做任何主张——等正式评测。' },
                    { t: 'p', html: '0.44B 装不下世界知识，这是物理事实，不是提示词能绕过去的问题。需要事实准确时请外挂检索与校验，代码请务必自己跑测试。把它当作架构与工程链路的可运行样本，而不是知识库。' },
                    { t: 'cta', href: 'https://www.modelscope.cn/models/guxingyu88730882/Cancri-2.5-Flash-Preview-0.5B', text: '在 ModelScope 上查看 Cancri 2.5 Flash 预览版' },
                    { t: 'p', html: '想看这条路线从哪里来，可以读 <a href="article.html?id=cancriV1">黑板中继</a> 与 <a href="article.html?id=blackboardPhase0">Phase-0 诊断</a>；想讨论或反馈，欢迎来 QQ 群 1076256254。' },
                    { t: 'note', html: '—— NexusVAI 呈献' }
                ]
            },
            en: {
                eyebrow: 'September 25, 2026',
                eyebrowTop: '8%',
                heading: 'Introducing Cancri 2.5 Flash Preview',
                toc: [
                    { id: 'introduction', label: 'Introduction' },
                    { id: 'whats-new', label: "What's new" },
                    { id: 'architecture', label: 'Architecture' },
                    { id: 'availability', label: 'Availability' }
                ],
                blocks: [
                    { t: 'anchor', id: 'introduction' },
                    { t: 'summary', text: 'Today we are releasing Cancri 2.5 Flash Preview: a 0.44B model trained from scratch, with a digit-splitting tokenizer and another ~7B tokens of continued pretraining. It is small, and it is not perfect — we are releasing it so you can run the architecture yourself.' },
                    { t: 'p', html: 'First, the lineage: Cancri is not a fine-tune of any open model — it is pretrained from random initialization, and that bloodline has never been broken. What this generation does is simple to state: on the 2.1 base we swap in a new tokenizer, continue pretraining for about 7 billion more tokens, then run SFT on 106k freshly cleaned instructions — roughly 20B tokens in total. Pretraining, continued training and SFT all ran on AMD GPUs under ROCm.' },
                    { t: 'p', html: 'The caveats first, because they matter: it has 439,371,264 parameters, the weights are 878 MB, the inference code is self-contained, and an ordinary CPU runs it — but it is not a knowledge base. 0.44B cannot hold world knowledge; numbers, details, multi-step reasoning and code logic will all go wrong. "Preview" means exactly this: training is finished, the pipeline works end to end, and systematic evaluation has not happened yet.' },
                    { t: 'p', html: 'So let it speak for itself. The four conversations below were recorded on an ordinary computer\'s CPU after release — they ran in Chinese, the model\'s first language; no wording was touched, long answers are excerpted, and the model\'s own <code>&lt;think&gt;</code> block is trimmed throughout.' },
                    { t: 'compare', tab: 'Q&A · dedupe a list', replayLabel: 'Replay the responses', prompt: '写一个 Python 函数：列表去重，但保持原来的顺序。',
                        sides: [
                            { label: 'Cancri 2.5 Flash Preview', toggleLabel: 'Reply', response: [
                                { code: 'def unique_dict(data):\n    """\n    对任意可迭代对象返回去重后的列表。\n\n    参数:\n        data (list/tuple): 可迭代对象\n\n    返回:\n        list: 去重后保持原始顺序的列表\n    """\n    seen = set()\n    result = []\n    for item in data:\n        if item not in seen:\n            seen.add(item)\n            result.append(item)\n    return result' },
                                { p: '(Ed.: the code above is verbatim; the explanatory tail was cut for fabrication.)' }
                            ] }
                        ],
                    },
                    { t: 'compare', tab: 'Q&A · one-line comfort', replayLabel: 'Replay the responses', prompt: '用一句话安慰一个加班到很晚的朋友。',
                        sides: [
                            { label: 'Cancri 2.5 Flash Preview', toggleLabel: 'Reply', response: [
                                { p: '"加班到很晚，真的很不容易。"' },
                                { p: '可以这样说：加班到很晚确实让人累，但它也是一种难得的休息和收获。你已经在为自己的目标努力了，这本身就是一种值得骄傲的成就。' },
                                { p: '如果需要更具体的情绪支持，也可以告诉我你的感受，我会帮你想想怎么表达。' }
                            ] }
                        ] },
                    { t: 'compare', tab: 'Q&A · what is a deadlock', replayLabel: 'Replay the responses', prompt: '什么是死锁？两三句话说清楚。',
                        sides: [
                            { label: 'Cancri 2.5 Flash Preview', toggleLabel: 'Reply', response: [
                                { p: '<strong>死锁（Dead-Lock）</strong>是指在并发系统中，两个或多个线程因争夺同一资源而相互等待对方释放的状态。它会导致程序无法继续执行，甚至可能崩溃。' },
                                { p: '(Ed.: the answer went on with a long classification list whose named terms were invented; trimmed.)' }
                            ] }
                        ] },
                    { t: 'compare', tab: 'Q&A · camping checklist', replayLabel: 'Replay the responses', prompt: '给我列三样周末露营容易忘带的东西，每个一句话。',
                        sides: [
                            { label: 'Cancri 2.5 Flash Preview', toggleLabel: 'Reply', response: [
                                { p: '1. <strong>便携帐篷</strong>——防水防风的防水袋或折叠式帐篷（带拉链或拉杆）；防潮垫或折叠垫，防止雨水渗入。' },
                                { p: '2. <strong>防潮垫/防潮地毯</strong>——厚实的地毯或羊毛毯，铺在帐篷边缘，防止地面潮湿；防滑地垫或地毯垫，保持地面干燥。' },
                                { p: '3. <strong>备用电池或充电宝</strong>——手机或笔记本电量不足时，带一个小型应急充电器或充电宝；便携的电池盒或快充头，随时补充电量。' }
                            ] }
                        ],
                        caption: 'Conversations recorded live with Cancri 2.5 Flash Preview · partially excerpted · answer text unchanged' },
                    { t: 'h2', id: 'whats-new', text: "What's new" },
                    { t: 'p', html: 'Architecture and parameter count are unchanged from 2.1; the work went into the data pipeline.' },
                    { t: 'grid', title: 'What changed since 2.1', subject: 1, columns: ['2.1-Flash', '2.5-Flash Preview'], rows: [
                        { label: 'Architecture / params', sub: 'BRP', cells: ['439,371,264', 'Unchanged'] },
                        { label: 'Tokenizer', sub: '32k BPE', cells: ['Multi-digit chunks', 'Digits split one by one, same IDs'] },
                        { label: 'Continued pretraining', sub: 'CPT', cells: ['+7B tokens', 'another ~7.0B tokens'] },
                        { label: 'SFT', sub: 'instruction tuning', cells: ['103,548 samples · 3 epochs', '106,523 + 128 held-out · 2 epochs'] },
                        { label: 'Inference code', cells: ['cancri_model.py / chat.py', 'byte-identical, plus a local web UI'] }
                    ], caption: 'The tokenizer gains exactly one rule — digits stand alone; the cost is roughly +7.9% tokens on digit-heavy text.' },
                    { t: 'p', html: 'Why touch the tokenizer: the old BPE had eight ways of splitting 0–9999 — <code>1147</code> becomes <code>11</code> and <code>47</code> in one context, something else in another. An unstable shape is hard on a small model learning arithmetic. In 2.5, digits are always split one by one: <code>1234567890 3.14</code> reliably becomes <code>1 2 3 4 5 6 7 8 9 0 . 3 1 4</code>. The vocabulary and every ID are unchanged, but it has to be paired with the <code>tokenizer.json</code> in this repository — running 2.5 weights on the 2.1 tokenizer raises no error; the output just quietly gets worse.' },
                    { t: 'p', html: 'Continued pretraining still starts from the 2.1 base: 35,500 steps at 196,608 tokens per step, about 7 billion tokens in total; the mix adds zh/en Ultra-FineWeb L3, UltraData-Math, CCI4.0 high-quality code and cross-segment long documents, and held-out perplexity in the annealing phase falls from 3.576 to 3.100. SFT then uses 106,523 samples (with 128 held out), two epochs and 4,084 steps, taking held-out masked perplexity from 13.23 to 6.792.' },
                    { t: 'p', html: 'There is a trap in these numbers worth pointing out: the tokenizer changed, and so did the held-out set, so perplexity cannot be compared across generations. The 3.100 and 6.792 of 2.5 and the 12.62 and 11.854 of 2.1 are not the same yardstick — a smaller number does not mean the model improved by that much.' },
                    { t: 'h2', id: 'architecture', text: 'Architecture: segment recurrence and blackboard handoff' },
                    { t: 'p', html: 'Cancri is not a standard decoder. One forward pass is a concatenation of three parts: the incoming board (32 slots), a 512-token segment, and 32 write-query slots; the hidden state at the write slots becomes the next segment\'s board. Segments pass state to each other through this 32×1536 activation rather than through a longer attention window.' },
                    { t: 'p', html: 'The direct consequence is memory. The KV cache covers a constant 576 positions — about 54 MB, independent of generation length. The same number of tokens through naive full attention: 768 MB at 8k, 3 GB at 32k, 12 GB at 128k.' },
                    { t: 'p', html: 'The board is also actually being used: on 8-segment held-out windows at the end of continued training, segments 2–8 score 3.100 perplexity when they receive the previous board, versus 3.677 when the board is not connected and only the initial board is given.' },
                    { t: 'quote', html: 'The discrete channel stores results that must be reused exactly; the continuous channel carries state for later computation. Both are produced by the same sub-task, but they follow different update and verification rules. … Field semantics are defined by behavior under intervention, not by slot names.', source: '— Cancri: A Dual-Channel Blackboard Architecture for Verifiable Collaboration' },
                    { t: 'p', html: 'One more boundary to draw: what ships today is a single general-purpose model. The board was designed for communication and working memory between experts, and multi-expert forking and board communication remain at the research stage — we make no capability claims about them here.' },
                    { t: 'h2', id: 'availability', text: 'Availability' },
                    { t: 'p', html: 'Cancri 2.5 Flash Preview is up on <a href="https://www.modelscope.cn/models/guxingyu88730882/Cancri-2.5-Flash-Preview-0.5B">ModelScope</a> under Apache 2.0. The repository ships its own inference code and a local web UI: <code>chat.py</code> for command-line conversations, <code>server.py</code> for a chat page bound to localhost only, and on Windows a double-click on <code>启动 Cancri.vbs</code>. Nothing beyond torch, tokenizers and safetensors is required.' },
                    { t: 'p', html: 'Ordinary machines run it: pure CPU (8 threads, fp32) takes about 1.8 GB of memory, loads in roughly 11 seconds and generates 2–8 tokens/s; a GPU is much faster. One thing to note — it cannot be loaded with <code>transformers.AutoModel</code>, since the architecture is not a standard decoder; use the code in the repository. Two rules we learned the hard way: do not send a system block (the training data contains none), and give it enough output budget — 57.9% of SFT samples use <code>&lt;think&gt;</code>, so answers often open with a long stretch of thinking.' },
                    { t: 'p', html: 'And in our usual style, the unflattering outputs are on the table too. The pre-release smoke test was four questions, one sample each, nothing cherry-picked:' },
                    { t: 'table', title: 'Pre-release smoke test (not cherry-picked, one sample each)', head: ['Prompt', 'Model output (excerpt)', 'Verdict'], rows: [
                        ['Who are you?', '"Cancri, trained by NexusVAI."', 'Identity correct, clean ending'],
                        ['What is the capital of China? Answer with the city name only.', '"Beijing" — then invents other "capitals"', 'Main answer right, ignores the instruction, fabricates'],
                        ['What is 37 + 48?', 'Final answer 85 is correct; the shown steps are nonsense', 'Right answer, wrong process'],
                        ['Write a Python function to test primality', 'Complete structure and comments, but 25 wrong on 0–100', 'Code logic not trustworthy']
                    ] },
                    { t: 'p', html: 'That is where it stands: format, tone and endings look right, and the main answer is often correct; details, process and code logic are not trustworthy. Whether the new tokenizer improved arithmetic has exactly one sample behind it — we make no claim, and we will wait for proper evaluation.' },
                    { t: 'p', html: 'A 0.44B model cannot store world knowledge. That is a physical fact, not something a prompt can route around. When facts matter, add retrieval and verification; when it writes code, run the tests yourself. Treat it as a runnable sample of the architecture and the engineering pipeline, not as a knowledge base.' },
                    { t: 'cta', href: 'https://www.modelscope.cn/models/guxingyu88730882/Cancri-2.5-Flash-Preview-0.5B', text: 'View Cancri 2.5 Flash Preview on ModelScope' },
                    { t: 'p', html: 'To see where this line of work comes from, read <a href="article.html?id=cancriV1">Blackboard Relay</a> and the <a href="article.html?id=blackboardPhase0">Phase-0 diagnostic</a>. For questions and feedback, join the QQ group 1076256254.' },
                    { t: 'note', html: '— Presented by NexusVAI' }
                ]
            }
        }
    };

    // ------------------------------------------------------------------ DOM
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    function inline(tag, cls, html) {
        var n = el(tag, cls);
        if (typeof window.renderArticleParagraph === 'function') window.renderArticleParagraph(n, html);
        else n.textContent = html;
        return n;
    }

    function renderGrid(b) {
        var fig = el('figure', 'lx-grid');
        var wrap = el('div', 'lx-grid-scroll');
        var table = el('table', 'lx-grid-table');
        var thead = el('thead');
        var hr = el('tr');
        hr.appendChild(el('td', 'lx-grid-corner'));
        b.columns.forEach(function (c, i) {
            var th = el('th', i === b.subject ? 'is-subject' : '', c);
            th.scope = 'col';
            hr.appendChild(th);
        });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = el('tbody');
        b.rows.forEach(function (r, ri) {
            var tr = el('tr', ri === b.rows.length - 1 ? 'is-last' : '');
            var th = el('th', 'lx-grid-label');
            th.scope = 'row';
            th.appendChild(el('span', 'lx-grid-cat', r.label));
            if (r.sub) th.appendChild(el('span', 'lx-grid-sub', r.sub));
            tr.appendChild(th);
            r.cells.forEach(function (v, i) {
                var td = el('td', i === b.subject ? 'is-subject' : '');
                var win = r.win ? r.win.indexOf(i) >= 0 : (v === '✓' && i === b.subject);
                if (win) td.classList.add('is-win');
                td.appendChild(el('span', 'lx-grid-value' + (i === b.subject ? ' is-bold' : ''), v));
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        if (b.title) fig.appendChild(el('p', 'lx-media-title', b.title));
        fig.appendChild(wrap);
        if (b.caption) fig.appendChild(el('figcaption', 'lx-grid-caption', b.caption));
        return fig;
    }

    function renderTable(b) {
        var box = el('div', 'lx-table');
        if (b.title) box.appendChild(el('p', 'lx-table-title', b.title));
        var t = el('table');
        var tb = el('tbody');
        var head = el('tr');
        b.head.forEach(function (h, i) {
            var th = el('th');
            if (i === 1) th.appendChild(el('strong', null, h)); else th.textContent = h;
            head.appendChild(th);
        });
        tb.appendChild(head);
        b.rows.forEach(function (r) {
            var tr = el('tr');
            r.forEach(function (c, i) {
                var td = el('td');
                if (i === 1) td.appendChild(el('strong', null, c)); else td.textContent = c;
                tr.appendChild(td);
            });
            tb.appendChild(tr);
        });
        t.appendChild(tb);
        box.appendChild(t);
        return box;
    }

    // 红蓝队演练对比（移植自 Anthropic 模型发布页的 ModelComparison 组件）：
    // 顶部标签 + 两栏并排卡片（左侧为旧、右侧为新），每栏一条用户提问气泡 +
    // 模型回复正文；窄屏用分段控件切栏，重播按钮重放逐块浮现动画。
    function renderCompare(b) {
        var fig = el('figure', 'lx-cmp');
        fig.dataset.show = 'latest';
        var sides = b.sides || [];

        var head = el('div', 'lx-cmp-head');
        var tabs = el('div', 'lx-cmp-tabs');
        tabs.appendChild(el('span', 'is-active', b.tab));
        head.appendChild(tabs);

        var controls = el('div', 'lx-cmp-controls');
        var toggle = el('div', 'lx-cmp-toggle');
        toggle.setAttribute('role', 'group');
        toggle.setAttribute('aria-label', b.tab);
        sides.forEach(function (s, i) {
            var isLatest = i === sides.length - 1;
            var btn = el('button', null, s.toggleLabel);
            btn.type = 'button';
            btn.setAttribute('aria-pressed', isLatest ? 'true' : 'false');
            btn.addEventListener('click', function () {
                fig.dataset.show = isLatest ? 'latest' : 'previous';
                Array.prototype.forEach.call(toggle.children, function (n, j) {
                    n.setAttribute('aria-pressed', j === i ? 'true' : 'false');
                });
            });
            toggle.appendChild(btn);
        });
        controls.appendChild(toggle);

        var replay = el('button', 'lx-cmp-replay');
        replay.type = 'button';
        replay.setAttribute('aria-label', b.replayLabel || 'Replay');
        var icon = svg('svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' });
        icon.appendChild(svg('path', { d: 'M11.6 7.2A4.6 4.6 0 1 1 10.2 3.6M10.6 1.4v2.6H8' }));
        replay.appendChild(icon);
        controls.appendChild(replay);
        head.appendChild(controls);
        fig.appendChild(head);

        var pair = el('div', 'lx-cmp-pair');
        sides.forEach(function (s, i) {
            var side = el('figure', 'lx-cmp-side');
            side.dataset.side = i === sides.length - 1 ? 'latest' : 'previous';
            side.appendChild(el('div', 'lx-cmp-label', s.label));
            var body = el('div', 'lx-cmp-body');
            var chat = el('div', 'lx-cmp-chat');
            chat.appendChild(el('p', 'lx-cmp-prompt lx-cmp-fade', b.prompt));
            var resp = el('div', 'lx-cmp-response');
            s.response.forEach(function (item) {
                if (item.code) {
                    var frame = el('div', 'lx-cmp-codeframe lx-cmp-fade');
                    var pre = el('pre', 'lx-cmp-code');
                    pre.tabIndex = 0;
                    pre.appendChild(el('code', null, item.code));
                    frame.appendChild(pre);
                    resp.appendChild(frame);
                } else {
                    resp.appendChild(inline('p', 'lx-cmp-fade', item.p));
                }
            });
            chat.appendChild(resp);
            body.appendChild(chat);
            side.appendChild(body);
            pair.appendChild(side);
        });
        fig.appendChild(pair);

        function reveal() {
            Array.prototype.forEach.call(fig.querySelectorAll('.lx-cmp-fade'), function (n, i) {
                n.style.animationDelay = (i * 120) + 'ms';
            });
            fig.classList.remove('is-revealing');
            void fig.offsetWidth;
            fig.classList.add('is-revealing');
        }
        replay.addEventListener('click', reveal);
        if (typeof IntersectionObserver === 'function') {
            var io = new IntersectionObserver(function (entries) {
                entries.forEach(function (en) {
                    if (!en.isIntersecting) return;
                    io.disconnect();
                    reveal();
                });
            }, { threshold: 0.25 });
            io.observe(fig);
        }

        if (b.caption) fig.appendChild(el('figcaption', 'lx-cmp-caption', b.caption));
        return fig;
    }

    var SVGNS = 'http://www.w3.org/2000/svg';
    function svg(tag, attrs, text) {
        var n = document.createElementNS(SVGNS, tag);
        Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
        if (text != null) n.textContent = text;
        return n;
    }

    function renderChart(b) {
        var fig = el('figure', 'lx-chart');
        var panel = el('div', 'lx-chart-panel');
        var cap = el('figcaption', 'lx-chart-caption');
        cap.appendChild(el('span', 'lx-chart-title', b.title));
        cap.appendChild(el('span', 'lx-chart-subtitle', b.subtitle));
        panel.appendChild(cap);

        var legend = el('ul', 'lx-chart-legend');
        b.series.forEach(function (s) {
            var li = el('li');
            var sw = svg('svg', { viewBox: '0 0 14 14', width: '14', height: '14', 'aria-hidden': 'true' });
            sw.appendChild(svg('circle', { cx: '7', cy: '7', r: '5.5', fill: s.color, class: 'lx-chart-mark' }));
            li.appendChild(sw);
            li.appendChild(s.emphasis ? el('strong', null, s.name) : el('span', null, s.name));
            legend.appendChild(li);
        });
        panel.appendChild(legend);

        var W = 760, H = 380, L = 64, R = 24, T = 16, B = 56;
        var pw = W - L - R, ph = H - T - B;
        var xs = b.xTicks, x0 = xs[0], x1 = xs[xs.length - 1];
        function X(v) { return L + (v - x0) / (x1 - x0) * pw; }
        function Y(v) { return T + ph - v / b.yMax * ph; }
        var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'lx-chart-svg', role: 'img', 'aria-label': b.title + ' — ' + b.subtitle });
        for (var v = 0; v <= b.yMax; v += b.yStep) {
            root.appendChild(svg('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: v === 0 ? 'lx-axis' : 'lx-gridline' }));
            root.appendChild(svg('text', { x: L - 10, y: Y(v) + 4, 'text-anchor': 'end', class: 'lx-tick' }, String(v)));
        }
        xs.forEach(function (x) {
            root.appendChild(svg('text', { x: X(x), y: H - B + 22, 'text-anchor': 'middle', class: 'lx-tick' }, b.xFixed != null ? x.toFixed(b.xFixed) : String(x)));
        });
        root.appendChild(svg('line', { x1: L, x2: L, y1: T, y2: T + ph, class: 'lx-axis' }));
        root.appendChild(svg('text', { x: L + pw / 2, y: H - 8, 'text-anchor': 'middle', class: 'lx-axis-label' }, b.xLabel));
        root.appendChild(svg('text', { x: 16, y: T + ph / 2, 'text-anchor': 'middle', class: 'lx-axis-label', transform: 'rotate(-90 16 ' + (T + ph / 2) + ')' }, b.yLabel));

        b.series.forEach(function (s) {
            var d = s.points.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join(' ');
            root.appendChild(svg('path', { d: d, stroke: s.color, class: 'lx-line' + (s.emphasis ? ' is-emphasis' : '') }));
            s.points.forEach(function (p, i) {
                root.appendChild(svg('circle', { cx: X(p[0]), cy: Y(p[1]), r: 4.5, fill: s.color, class: 'lx-chart-mark' }));
                var label = p[2] != null ? p[2] + ' · ' + p[0].toFixed(2) : String(p[1]);
                root.appendChild(svg('text', { x: X(p[0]), y: Y(p[1]) + 24, 'text-anchor': 'middle', class: 'lx-point-label' }, label));
            });
        });
        var plot = el('div', 'lx-chart-plot');
        plot.appendChild(root);
        panel.appendChild(plot);
        fig.appendChild(panel);
        if (b.note) fig.appendChild(el('p', 'lx-chart-note', b.note));
        return fig;
    }

    function renderBlock(b) {
        switch (b.t) {
            case 'anchor': { var a = el('span', 'lx-anchor'); a.id = b.id; return a; }
            case 'summary': return el('p', 'lx-col lx-summary', b.text);
            case 'p': return inline('p', 'lx-col lx-text', b.html);
            case 'h2': { var h = el('h2', 'lx-col lx-heading', b.text); h.id = b.id; return h; }
            case 'grid': { var g = el('div', 'lx-media'); g.appendChild(renderGrid(b)); return g; }
            case 'table': { var tw = el('div', 'lx-media is-inline'); tw.appendChild(renderTable(b)); return tw; }
            case 'compare': { var cw = el('div', 'lx-media'); cw.appendChild(renderCompare(b)); return cw; }
            case 'quote': {
                var q = inline('blockquote', 'lx-col lx-quote', b.html);
                if (b.source) q.appendChild(el('cite', 'lx-quote-source', b.source));
                return q;
            }
            case 'chart': { var cw = el('div', 'lx-media'); cw.appendChild(renderChart(b)); return cw; }
            case 'note': return inline('p', 'lx-col lx-sign', b.html);
            case 'cta': {
                var wrap = el('p', 'lx-col lx-cta-row');
                var link = el('a', 'lx-cta btn-pill', b.text);
                link.href = b.href;
                link.rel = 'noopener';
                wrap.appendChild(link);
                return wrap;
            }
            default: return document.createTextNode('');
        }
    }

    function renderHero(item, c) {
        var hero = el('section', 'lx-hero');
        hero.setAttribute('aria-labelledby', 'lx-hero-title');
        var stage = el('div', 'lx-stage');
        var img = el('img', 'lx-cover');
        img.src = item.media && item.media.src;
        img.alt = '';
        img.decoding = 'async';
        stage.appendChild(img);
        var landing = el('div', 'lx-landing');
        var eyebrow = el('p', 'lx-eyebrow', c.eyebrow);
        // 各封面画面重心不同；个别文章可用 eyebrowTop 覆盖 CSS 默认的 21% 位置。
        if (c.eyebrowTop) eyebrow.style.top = c.eyebrowTop;
        // 深色封面（如 cancriBot）上默认墨色看不见，可用 eyebrowColor 覆盖。
        if (c.eyebrowColor) eyebrow.style.color = c.eyebrowColor;
        landing.appendChild(eyebrow);
        var h1 = el('h1', 'lx-visually-hidden', c.heading);
        h1.id = 'lx-hero-title';
        landing.appendChild(h1);
        stage.appendChild(landing);
        hero.appendChild(stage);

        var nav = el('nav', 'lx-toc-nav');
        nav.setAttribute('aria-label', c.heading);
        var ol = el('ol', 'lx-toc');
        c.toc.forEach(function (t, i) {
            var li = el('li');
            var a = el('a');
            a.href = '#' + t.id;
            a.appendChild(el('span', 'lx-n', '(' + (i + 1) + ')'));
            a.appendChild(el('span', 'lx-dots'));
            a.appendChild(el('span', 'lx-toc-label', t.label));
            a.addEventListener('click', function (e) {
                var target = document.getElementById(t.id);
                if (!target) return;
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            li.appendChild(a);
            ol.appendChild(li);
        });
        nav.appendChild(ol);
        hero.appendChild(nav);
        return hero;
    }

    /** 返回 true 表示已按发布稿版式渲染。 */
    window.renderLaunchArticle = function (id, item, lang, articleRoot) {
        var content = LAUNCH_CONTENT[id];
        if (!content) return false;
        var c = content[lang] || content.zh;
        document.documentElement.classList.add('is-launch-article');
        articleRoot.classList.add('lx-page');

        var old = articleRoot.querySelector('.lx-hero');
        if (old) old.remove();
        articleRoot.insertBefore(renderHero(item, c), articleRoot.firstChild);

        var bodyEl = articleRoot.querySelector('.article-body');
        if (bodyEl) {
            bodyEl.replaceChildren();
            bodyEl.classList.add('lx-body');
            bodyEl.appendChild(el('p', 'lx-col lx-title', c.heading));
            c.blocks.forEach(function (b) { bodyEl.appendChild(renderBlock(b)); });
        }
        return true;
    };
})();
