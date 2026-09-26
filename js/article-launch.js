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

    // 内部评测（2026-09）：同一组 5 道题，模型 deepseek-flash，按低谷时段价格计费。
    // 三个档位各跑一遍，15 次全部解决。Medium 本轮未测。
    var EVAL = {
        Low: { cost: 0.24, total: 1.18, input: '13.6M', output: '185K', cache: '98.7%', minutes: 34 },
        High: { cost: 0.32, total: 1.60, input: '23.8M', output: '228K', cache: '99.1%', minutes: 57 },
        Ultracode: { cost: 0.36, total: 1.82, input: '27.0M', output: '256K', cache: '99.1%', minutes: 65 }
    };

    function evalSeries(name) {
        return [{
            name: name,
            color: '#d97757',
            emphasis: true,
            points: ['Low', 'High', 'Ultracode'].map(function (k) { return [EVAL[k].cost, 100, k]; })
        }];
    }

    var DOWNLOAD_URL = 'https://dl.nexusvai.xyz/cancri-code/3.0.2/Cancri-Code_3.0.2_x64-setup.exe';

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
                    { t: 'p', html: '档位到底值不值那份钱，与其讲道理，不如跑一遍。我们挑了 5 道题，用同一个模型（deepseek-flash），让 Low、High、Ultracode 三个档位各自从头做一遍，按评分脚本判定是否解决。' },
                    { t: 'grid', title: '同一组 5 道题，三个档位', subject: 0, columns: ['Low', 'High', 'Ultracode'], rows: [
                        { label: '解决', sub: '5 道题', cells: ['5/5', '5/5', '5/5'], win: [0, 1, 2] },
                        { label: '每题均价', sub: '人民币', cells: ['0.24 元', '0.32 元', '0.36 元'], win: [0] },
                        { label: '5 题合计', sub: '人民币', cells: ['1.18 元', '1.60 元', '1.82 元'], win: [0] },
                        { label: '输入 token', sub: '含缓存读取', cells: ['13.6M', '23.8M', '27.0M'], win: [0] },
                        { label: '输出 token', cells: ['185K', '228K', '256K'], win: [0] },
                        { label: '缓存命中率', cells: ['98.7%', '99.1%', '99.1%'], win: [1, 2] },
                        { label: '总耗时', sub: '5 题合计', cells: ['34 分钟', '57 分钟', '65 分钟'], win: [0] }
                    ], caption: '模型 deepseek-flash，价格按低谷时段计。High 档第 4 题在评分时模型仍在做收尾验证，补丁已完成并通过评分，计为解决。默认档 Medium 本轮未测。' },
                    { t: 'chart', title: '解决率 vs 每题成本', subtitle: '同一模型，三个努力档位', xLabel: '每题成本（元）', yLabel: '解决率（%）', xTicks: [0.2, 0.25, 0.3, 0.35, 0.4], xFixed: 2,yMax: 100, yStep: 20, series: evalSeries('Cancri Code 3 · deepseek-flash'), note: '三个档位都解决了全部 5 道题；档位越高，每题成本越高。在这组题的难度上，Low 是成本最低的那个点。' },
                    { t: 'p', html: '结果很朴素：三个档位全部 5/5。区别在账单和时间上——从 Low 到 Ultracode，每题成本从 0.24 元涨到 0.36 元，多了一半；总耗时从 34 分钟拉长到 65 分钟，将近翻倍；输入 token 也翻了一倍，多出来的基本都是反复读代码、反复验证。' },
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
                    { t: 'note', html: '—— Cancri Code 联合创始人' }
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
                    { t: 'p', html: 'Rather than argue whether the levels are worth the money, we ran them. We picked 5 tasks and one model (deepseek-flash), had Low, High and Ultracode each work through them from scratch, and used a grading script to decide whether each was solved.' },
                    { t: 'grid', title: 'The same 5 tasks, three levels', subject: 0, columns: ['Low', 'High', 'Ultracode'], rows: [
                        { label: 'Solved', sub: 'out of 5', cells: ['5/5', '5/5', '5/5'], win: [0, 1, 2] },
                        { label: 'Cost per task', sub: 'CNY', cells: ['¥0.24', '¥0.32', '¥0.36'], win: [0] },
                        { label: 'Total for 5 tasks', sub: 'CNY', cells: ['¥1.18', '¥1.60', '¥1.82'], win: [0] },
                        { label: 'Input tokens', sub: 'incl. cache reads', cells: ['13.6M', '23.8M', '27.0M'], win: [0] },
                        { label: 'Output tokens', cells: ['185K', '228K', '256K'], win: [0] },
                        { label: 'Cache hit rate', cells: ['98.7%', '99.1%', '99.1%'], win: [1, 2] },
                        { label: 'Total time', sub: 'all 5 tasks', cells: ['34 min', '57 min', '65 min'], win: [0] }
                    ], caption: 'Model: deepseek-flash, priced at off-peak rates. On High, task 4 was still running its final verification when graded; the patch was complete and passed grading, so it counts as solved. The default level, Medium, was not part of this run.' },
                    { t: 'chart', title: 'Solve rate vs cost per task', subtitle: 'One model, three effort levels', xLabel: 'Cost per task (CNY)', yLabel: 'Solve rate (%)', xTicks: [0.2, 0.25, 0.3, 0.35, 0.4], xFixed: 2,yMax: 100, yStep: 20, series: evalSeries('Cancri Code 3 · deepseek-flash'), note: 'All three levels solved all 5 tasks; higher levels cost more per task. At this difficulty, Low is the cheapest point.' },
                    { t: 'p', html: 'The result is plain: all three levels went 5 for 5. The differences are in the bill and the clock. From Low to Ultracode, cost per task rose from ¥0.24 to ¥0.36, half again as much; total time went from 34 to 65 minutes, nearly double; input tokens doubled too, almost all of it spent re-reading code and re-checking work.' },
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
                    { t: 'note', html: '— Co-founder, Cancri Code' }
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
            case 'chart': { var cw = el('div', 'lx-media'); cw.appendChild(renderChart(b)); return cw; }
            case 'note': return inline('p', 'lx-col lx-sign', b.html);
            case 'cta': {
                var wrap = el('p', 'lx-col lx-cta-row');
                var link = el('a', 'lx-cta', b.text);
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
        landing.appendChild(el('p', 'lx-eyebrow', c.eyebrow));
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
