function initArticlePage() {
    const articleRoot = document.querySelector('.article-page');
    if (!articleRoot) return;

    const articleData = {
        hero: {
            title: '赋予洛圣都数字灵魂',
            date: '2026 年 3 月 01 日',
            category: '公司',
            media: { type: 'video', src: 'Logo/HORE1.mp4', alt: 'Sentience 演示视频' },
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
        n1: {
            title: '隆重推出 Sentience V3.1',
            date: '2026年3月02日',
            category: '架构',
            media: { type: 'image', src: 'Logo/N1.jpg', alt: 'Sentience V3.1' },
            paragraphs: [
                'Sentience V3.1 旨在提升交互的自然度与角色一致性。',
                '本页展示文章详情页的标准结构：顶部元信息、标题、媒体区、正文段落。',
                '后续你提供正式文案后，可直接替换 paragraphs 内容。'
            ]
        },
        n2: {
            title: '了解 TACTFR V5',
            date: '2026年3月03日',
            category: '文档',
            media: { type: 'image', src: 'Logo/N2.jpg', alt: 'TACTFR V5' },
            paragraphs: [
                'TACTFR V5 聚焦于更稳定的接入方式与更清晰的能力边界。',
                '这里先用占位内容，保证排版与层级接近 OpenAI 的文章页。',
                '当你需要更像 OpenAI 的“分节标题 + 段落”，我们也可以继续加上。'
            ]
        },
        n3: {
            title: '了解 NexusV V4',
            date: '2026年2月26日',
            category: '安全',
            media: { type: 'image', src: 'Logo/N3.jpg', alt: 'NexusV V4' },
            paragraphs: [
                'NexusV V4 将安全策略与体验统一到同一套交互结构里。',
                '这是一篇占位文章，用于承接首页卡片点击后的阅读路径。',
                '后续可扩展：目录、引用块、代码块、图注、更多媒体等。'
            ]
        },
        news1: {
            title: '让我们携手共进',
            date: '2026年3月01日',
            category: '公司',
            media: { type: 'image', src: 'Logo/H2.webp', alt: '携手共进' },
            paragraphs: [
                '在 NexusV 的发展历程中，每一次合作都是为了构建更强大的数字未来。',
                '我们正在与全球领先的合作伙伴共同探索 AI 的边界，确保每一项技术突破都能造福人类。'
            ]
        },
        news2: {
            title: '在TACTFR中尝试接入Sentience',
            date: '2026年03月03日',
            category: '公司',
            media: { type: 'image', src: 'Logo/yellow-blue-bg.webp', alt: 'TACTFR' },
            paragraphs: [
                'TACTFR 框架现已支持 Sentience 核心模块的无缝接入。',
                '这一整合将极大提升系统的响应速度与情境理解能力，为开发者提供更灵活的工具集。'
            ]
        },
        news3: {
            title: 'NexusV 免责声明',
            date: '2026 年 3 月 02 日',
            category: '公司',
            media: { type: 'image', src: 'Logo/OAI_Systems_Blog_Card.webp', alt: '免责声明' },
            paragraphs: [
                '关于 NexusV 相关技术的使用规范与免责条款更新。',
                '我们致力于构建安全、可信赖的 AI 系统，请务必仔细阅读最新的使用协议。',
                'NexusV 模组（以下简称"本模组"）是由 [某宇]（以下简称"开发者"）开发的用于《侠盗猎车手 5》(Grand Theft Auto V) 的非官方第三方修改工具。NexusV 模组旨在通过集成大语言模型 (LLM) 技术增强游戏中的非玩家角色 (NPC) 互动体验。',
                '当您下载、安装或使用 NexusV 模组时，即表示您已完全理解并无条件同意以下所有条款。如果您不同意这些条款，请立即停止使用并删除 NexusV 模组及其所有相关文件。',
                '1. 软件性质与许可',
                '1.1 TACTFR、Sentience 模组基于 MIT 许可证分发，属于开源软件，供个人非商业用途免费使用。',
                '1.2 NexusV 模组并非 Rockstar Games、Take-Two Interactive 或其关联公司的官方产品，亦未获得其授权、赞助或认可。',
                '1.3 NexusV 模组仅作为技术演示和娱乐用途提供，不保证其适用性、可靠性或无错误。',
                '2. 免责声明 (DISCLAIMER OF WARRANTIES)',
                '2.1 NexusV 模组按"原样"(AS IS) 提供，不附带任何明示或暗示的担保，包括但不限于对适销性、特定用途适用性及不侵权的担保。',
                '2.2 开发者不保证 NexusV 模组能够不间断运行、无错误、无病毒或其他有害组件。',
                '2.3 对于因使用或无法使用 NexusV 模组而导致的任何直接、间接、偶然、特殊、后果性或惩罚性损害（包括但不限于数据丢失、游戏账号封禁、硬件损坏、利润损失或业务中断），开发者概不负责，即使开发者已被告知发生此类损害的可能性。',
                '2.4 您知悉并同意：修改游戏文件可能违反 Rockstar Games 的服务条款，甚至导致您的在线账号被永久封禁。使用 NexusV 模组的所有风险完全由您自行承担。建议仅在单人模式下使用。',
                '3. AI 生成内容声明 (AI GENERATED CONTENT)',
                '3.1 Sentience 模组集成了大语言模型 (LLM) 技术，游戏内 NPC 的对话内容由 AI 实时生成。',
                '3.2 AI 生成的所有对话、观点、情节或"觉醒"言论仅代表 AI 模型的输出结果，不代表开发者、Rockstar Games 或任何第三方的立场或观点。',
                '3.3 由于 AI 技术的不可预测性，NexusV 模组可能会生成错误、虚构、令人反感或不适的内容。开发者不对 AI 生成内容的准确性、合法性或道德性承担任何责任。',
                '3.4 严禁利用 NexusV 模组生成、传播或诱导 AI 产生违反当地法律法规的内容，包括但不限于：',
                '- 色情、淫秽或性暗示内容；',
                '- 暴力、恐怖、血腥或教唆犯罪的内容；',
                '- 政治敏感、仇恨言论、歧视性或侮辱性内容；',
                '- 侵犯他人隐私或名誉权的内容。',
                '4. 禁止非法用途 (PROHIBITED USES)',
                '4.1 您不得将 NexusV 模组用于任何非法目的，或用于制作、上传、发布任何违反法律法规的内容。',
                '4.2 您不得利用 NexusV 模组进行任何形式的商业盈利活动（如倒卖、付费下载等），除非获得开发者的书面授权。',
                '4.3 您不得对 NexusV 模组进行逆向工程、反编译或反汇编，不得利用 NexusV 模组开发旨在规避游戏安全机制的作弊软件。',
                '5. 知识产权声明',
                '5.1 《侠盗猎车手 5》(Grand Theft Auto V) 及其所有相关资产、商标、标识的知识产权归 Rockstar Games 及 Take-Two Interactive 所有。',
                '5.2 NexusV 模组中引用的第三方库（如 ScriptHookV, ScriptHookVDotNet, NAudio, Newtonsoft.Json 等）的知识产权归其各自的作者或版权所有者所有，NexusV 模组仅在许可范围内使用。',
                '5.3 NexusV 模组的源代码及原创部分版权归开发者所有。',
                '6. 协议修改与终止',
                '6.1 开发者保留随时修改、更新或终止本协议的权利，无需提前通知。',
                '6.2 如果您违反本协议的任何条款，您的使用许可将自动终止，您必须立即销毁 NexusV 模组的所有副本。',
                '7. 适用法律',
                '7.1 本协议的解释、效力及纠纷解决，适用中华人民共和国法律。',
                '7.2 若本协议的任何条款被法院裁定为无效或不可执行，不影响其他条款的效力。'
            ]
        },
        news4: {
            title: '模组登陆玩家动力',
            date: '2025年12月30日',
            category: '公司',
            media: { type: 'image', src: 'Logo/updated_team-1.webp', alt: '玩家动力' },
            paragraphs: [
                'NexusV 模组现已正式登陆玩家动力平台，为数百万玩家带来全新的互动体验。',
                '此次发布标志着我们在游戏生态领域的进一步拓展。'
            ]
        },
        news5: {
            title: '我们确保每一次使用都是安全的',
            date: '2026 年 2 月 13 日',
            category: '安全',
            media: { type: 'image', src: 'Logo/N3.jpg', alt: '安全' },
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
        news6: {
            title: '深入了解Sentience-V3.1',
            date: '2026年2月12日',
            category: '产品',
            media: { type: 'image', src: 'Logo/ChatGPT_Charts_Blog_Hero.webp', alt: 'Sentience-V3.1' },
            paragraphs: [
                'Sentience V3.1 带来了前所未有的理解深度与表达能力。',
                '本文将详细解析新版本的架构改进与性能提升数据。'
            ]
        },
        news7: {
            title: 'Sentience 正式登场',
            date: '2026 年 2 月 26 日',
            category: '产品',
            media: { type: 'video', src: 'Logo/Sora_is_here.mp4', alt: 'Sentience 登场' },
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
        news8: {
            title: 'NexusV 更新日志',
            date: '2026年1月20日',
            category: '产品',
            media: { type: 'image', src: 'Logo/enterprise.webp', alt: '更新日志' },
            paragraphs: [
                'NexusV 最新版本的详细更新记录。',
                '包含了多项性能优化、API 接口调整以及已知问题的修复。'
            ]
        }
    };

    const params = new URLSearchParams(window.location.search);
    const id = params.get('id') || 'hero';
    const data = articleData[id] || articleData.hero;

    const dateEl = articleRoot.querySelector('.article-date');
    const categoryEl = articleRoot.querySelector('.article-category');
    const titleEl = articleRoot.querySelector('.article-title');
    const bodyEl = articleRoot.querySelector('.article-body');
    const shareBtn = articleRoot.querySelector('.share-link-btn');
    const authorPill = articleRoot.querySelector('.author-pill');
    const crGrid = articleRoot.querySelector('.cr-grid');

    if (dateEl) dateEl.textContent = data.date;
    if (categoryEl) categoryEl.textContent = data.category;
    if (titleEl) titleEl.textContent = data.title;
    document.title = `${data.title} | NexusV`;
    
    if (authorPill && data.date) {
        const year = data.date.match(/\d{4}/);
        if (year) authorPill.textContent = `${year[0]} 年`;
    }

    if (bodyEl) {
        bodyEl.innerHTML = '';
        (data.paragraphs || []).forEach(t => {
            const p = document.createElement('p');
            p.textContent = t;
            bodyEl.appendChild(p);
        });
    }

    if (crGrid) {
        // 随机显示 3 篇不同的文章，确保不重复
        const allKeys = Object.keys(articleData).filter(k => k !== id);
        
        // Fisher-Yates 洗牌算法，确保真随机且不重复
        for (let i = allKeys.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allKeys[i], allKeys[j]] = [allKeys[j], allKeys[i]];
        }
        
        const selectedKeys = allKeys.slice(0, 3);
        
        selectedKeys.forEach(key => {
            const item = articleData[key];
            const card = document.createElement('a');
            card.className = 'cr-card';
            card.href = `article.html?id=${key}`;
            
            let mediaHtml = '';
            let fallback = '';
            // Specific fallback for news1 (Let's work together)
            if (key === 'news1') {
                fallback = `onerror="this.onerror=null;this.src='Logo/I2.webp'"`;
            }

            if (item.media?.type === 'video') {
                    mediaHtml = `<div class="image-wrapper square-image"><video src="${item.media.src}" muted playsinline loop onmouseover="this.play()" onmouseout="this.pause()"></video></div>`;
            } else {
                mediaHtml = `<div class="image-wrapper square-image"><img src="${item.media?.src}" alt="${item.media?.alt}" ${fallback}></div>`;
            }

            card.innerHTML = `
                ${mediaHtml}
                <h4>${item.title}</h4>
                <div class="meta"><span class="news-category">${item.category}</span> ${item.date}</div>
            `;
            crGrid.appendChild(card);
        });
    }

    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            const url = window.location.href;
            try {
                await navigator.clipboard.writeText(url);
                const originalHTML = shareBtn.innerHTML;
                const currentLang = localStorage.getItem('lang') || 'zh';
                const copiedText = currentLang === 'zh' ? '已复制链接' : 'Link Copied';
                
                // Add success class for animation
                shareBtn.classList.add('share-success');
                shareBtn.innerHTML = `
                    <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    <span>${copiedText}</span>
                `;
                
                setTimeout(() => {
                    shareBtn.classList.remove('share-success');
                    shareBtn.innerHTML = originalHTML;
                    // Trigger reflow to restart animation
                    const newSpan = shareBtn.querySelector('span');
                    const newIcon = shareBtn.querySelector('svg');
                    if (newSpan) {
                        newSpan.style.animation = 'none';
                        newSpan.offsetHeight; /* trigger reflow */
                        newSpan.style.animation = 'fadeIn 0.3s ease';
                    }
                    if (newIcon) {
                        newIcon.style.animation = 'none';
                        newIcon.offsetHeight; /* trigger reflow */
                        newIcon.style.animation = 'fadeIn 0.3s ease';
                    }
                }, 2000);
            } catch (err) {
                console.error('Failed to copy: ', err);
            }
        });
    }
}

window.initArticlePage = initArticlePage;
