// 移植自 cancri-code/src/ui/grok-bot/cancri-crab.js（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/*! CancriCode 吉祥物小蟹 <cancri-crab> — 零依赖 Web Component
 * 用法: <script src="cancri-crab.js"></script>
 *       <cancri-crab state="idle" style="width:160px"></cancri-crab>
 * state: 单选，idle | think | talk | work | happy | error | sleep | crazy 癫狂 | sulk 生气不理人
 *   smoke 抽烟 | phone 刷手机 | laptop 掏电脑 | headphones 听音乐 | gun 掏枪耍枪吹气
 *   heart 比心 | sweat 流汗 | question 头顶问号 | hearts 冒爱心 | bubble 吹泡泡糖
 *   dumbbell 举哑铃 | chicken 捏尖叫鸡 | money 见钱眼开撒钱
 * accessory: 装饰，可多个空格隔开: wizard 魔法帽 | cowboy 牛仔帽 | cap 鸭舌帽 | glasses 眼镜 | stache 胡子
 *   magnifier 放大镜 | coffee 咖啡杯 | crown 皇冠 | bling 墨镜金链
 *   santa 圣诞帽 | birthday 生日帽蛋糕 | zongzi 粽子 | mooncake 月饼 | baton 指挥棒
 *   例: <cancri-crab state="bubble" accessory="cowboy stache"></cancri-crab>
 *   装饰用 data-to 挂到身体/脸/左钳/右钳上，随部件动画一起动。
 *   laptop、gun 切换到其他状态后再切回可重播；音乐为视觉动画，不播放音频。
 * 属性: follow（眼睛跟随鼠标，默认开，设 follow="off" 关闭）
 * 换色: CSS 变量 --crab / --crab-shade / --crab-eye / --crab-spark
 */
(function(){
const CSS='\n.cc{--st:steps(1,end)}\n.cc svg{display:block;overflow:visible}\n.cc g{transform-box:view-box}\n.cc .cc-shut,.cc .cc-eyes-happy,.cc .cc-eyes-x,.cc .cc-eyes-closed,.cc .cc-mouth,.cc .cc-fx-think,.cc .cc-fx-zzz,.cc .cc-fx-spark{display:none}\n.cc .cc-claw-l{transform-origin:30px 60px}.cc .cc-claw-r{transform-origin:114px 60px}\n.cc .cc-body{transform-origin:72px 108px}.cc .cc-face{transform-origin:72px 66px}\n.cc .cc-eyes{transform-origin:72px 66px}.cc .cc-mouth{transform-origin:72px 83px}\n.cc .cc-all{transform-origin:72px 108px}\n/* idle */\n.cc.s-idle .cc-body{animation:cc-breathe 2.4s var(--st) infinite}\n.cc.s-idle .cc-claw-l{animation:cc-bob 2.4s var(--st) infinite}\n.cc.s-idle .cc-claw-r{animation:cc-bob 2.4s var(--st) infinite .6s}\n.cc.s-idle .cc-eyes,.cc.s-think .cc-eyes,.cc.s-talk .cc-eyes{animation:cc-blink 5.3s var(--st) infinite}\n.cc.js-blink .cc-eyes{animation:none!important}\n.cc.js-blink.blinking .cc-eyes{transform:scaleY(.15)}\n/* think */\n.cc.s-think .cc-face{transform:translate(4.5px,-3px)}\n.cc.s-think .cc-claw-r{animation:cc-tap .8s var(--st) infinite}\n.cc.s-think .cc-fx-think{display:inline}\n.cc.s-think .cc-fx-think .d1{animation:cc-dot 1.6s var(--st) infinite}\n.cc.s-think .cc-fx-think .d2{animation:cc-dot 1.6s var(--st) infinite .4s}\n.cc.s-think .cc-fx-think .d3{animation:cc-dot 1.6s var(--st) infinite .8s}\n/* talk */\n.cc.s-talk .cc-mouth{display:inline;animation:cc-mouth .36s var(--st) infinite}\n.cc.s-talk .cc-body{animation:cc-breathe .72s var(--st) infinite}\n.cc.s-talk .cc-claw-l{animation:cc-bob .72s var(--st) infinite}\n.cc.s-talk .cc-claw-r{animation:cc-bob .72s var(--st) infinite .36s}\n/* work */\n.cc.s-work .cc-eyes{transform:scaleY(.6)}\n.cc.s-work .cc-claw-l .cc-open{animation:cc-show .5s var(--st) infinite}\n.cc.s-work .cc-claw-l .cc-shut{display:inline;animation:cc-hide .5s var(--st) infinite}\n.cc.s-work .cc-claw-r .cc-open{animation:cc-show .5s var(--st) infinite .25s}\n.cc.s-work .cc-claw-r .cc-shut{display:inline;animation:cc-hide .5s var(--st) infinite .25s}\n.cc.s-work .cc-all{animation:cc-scuttle .5s var(--st) infinite}\n.cc.s-work .cc-legs-l,.cc.s-work .cc-legs-r{animation:cc-leg .25s var(--st) infinite}\n/* happy */\n.cc.s-happy .cc-eyes{display:none}.cc.s-happy .cc-eyes-happy{display:inline}\n.cc.s-happy .cc-all{animation:cc-jump 1s var(--st) infinite}\n.cc.s-happy .cc-claw-l{transform:translate(-3px,-6px)}.cc.s-happy .cc-claw-r{transform:translate(3px,-6px)}\n.cc.s-happy .cc-fx-spark{display:inline;animation:cc-blinkfx .5s var(--st) infinite}\n.cc.s-happy .cc-fx-spark .s2{animation:cc-blinkfx .5s var(--st) infinite .25s}\n/* error */\n.cc.s-error .cc-eyes{display:none}.cc.s-error .cc-eyes-x{display:inline}\n.cc.s-error .cc-all{animation:cc-shake 1.6s var(--st) infinite}\n.cc.s-error .cc-claw-l,.cc.s-error .cc-claw-r{transform:translateY(6px)}\n/* sleep */\n.cc.s-sleep .cc-eyes{display:none}.cc.s-sleep .cc-eyes-closed{display:inline}\n.cc.s-sleep .cc-body{animation:cc-breathe 3.6s var(--st) infinite}\n.cc.s-sleep .cc-claw-l,.cc.s-sleep .cc-claw-r{transform:translateY(9px)}\n.cc.s-sleep .cc-fx-zzz{display:inline}\n.cc.s-sleep .cc-fx-zzz .z1{animation:cc-dot 3.6s var(--st) infinite}\n.cc.s-sleep .cc-fx-zzz .z2{animation:cc-dot 3.6s var(--st) infinite 1.2s}\n@keyframes cc-breathe{0%{transform:translateY(0)}50%{transform:translateY(1.5px)}}\n@keyframes cc-bob{0%{transform:translateY(0)}50%{transform:translateY(-3px)}}\n@keyframes cc-tap{0%{transform:translateY(0)}50%{transform:translateY(-4.5px)}}\n@keyframes cc-blink{0%{transform:scaleY(1)}40%{transform:scaleY(.15)}42%{transform:scaleY(1)}86%{transform:scaleY(.15)}87.5%{transform:scaleY(1)}89%{transform:scaleY(.15)}90.5%{transform:scaleY(1)}}\n@keyframes cc-dot{0%{opacity:0}25%{opacity:1}75%{opacity:0}}\n@keyframes cc-mouth{0%{transform:scaleY(.4)}50%{transform:scaleY(1.4)}}\n@keyframes cc-show{0%{opacity:1}50%{opacity:0}}\n@keyframes cc-hide{0%{opacity:0}50%{opacity:1}}\n@keyframes cc-scuttle{0%{transform:translateX(0)}25%{transform:translateX(3px)}50%{transform:translateX(0)}75%{transform:translateX(-3px)}}\n@keyframes cc-leg{0%{transform:translateY(0)}50%{transform:translateY(-3px)}}\n@keyframes cc-jump{0%{transform:translateY(0)}10%{transform:translateY(3px) scaleY(.94)}20%{transform:translateY(-12px)}30%{transform:translateY(-15px)}45%{transform:translateY(-6px)}55%{transform:translateY(0)}60%{transform:translateY(1.5px) scaleY(.96)}70%{transform:translateY(0)}}\n@keyframes cc-blinkfx{0%{opacity:1}50%{opacity:0}}\n@keyframes cc-shake{0%{transform:translateX(0)}5%{transform:translateX(-4.5px)}10%{transform:translateX(4.5px)}15%{transform:translateX(-4.5px)}20%{transform:translateX(4.5px)}25%{transform:translateX(0)}}\n@media (prefers-reduced-motion:reduce){.cc *{animation:none!important}}\n\n.cc .acc{display:none}\n.cc.a-wizard .acc-wizard,.cc.a-cowboy .acc-cowboy,.cc.a-cap .acc-cap,.cc.a-glasses .acc-glasses,.cc.a-stache .acc-stache,.cc.a-smoke .acc-smoke,.cc.a-phone .acc-phone,.cc.a-laptop .acc-laptop{display:inline}\n.cc.a-stache .cc-mouth,.cc.a-smoke .cc-mouth{display:none}\n.cc.a-smoke .cc-eyes{transform:scaleY(.65)}\n.cc.a-smoke .ember{animation:cc-ember 1.2s var(--st) infinite}\n.cc.a-smoke .sm1{animation:cc-dot 2s var(--st) infinite}\n.cc.a-smoke .sm2{animation:cc-dot 2s var(--st) infinite .4s}\n.cc.a-smoke .sm3{animation:cc-dot 2s var(--st) infinite .8s}\n.cc.a-smoke .sm4{animation:cc-dot 2s var(--st) infinite 1.2s}\n.cc.a-phone .cc-claw-l{animation:none!important;transform:translate(30px,46px)}.cc.a-phone .cc-claw-r{animation:none!important;transform:translate(-30px,46px)}\n.cc.a-phone .cc-face{transform:translateY(4.5px)}\n.cc.a-phone .scrA{animation:cc-show .6s var(--st) infinite}\n.cc.a-phone .scrB{animation:cc-hide .6s var(--st) infinite}\n.cc.a-laptop .lap-peek{opacity:0;animation:cc-lap-peek 2.4s var(--st) forwards}\n.cc.a-laptop .lap-base{opacity:0;animation:cc-lap-base 2.4s var(--st) forwards}\n.cc.a-laptop .lap-lid{animation:cc-lap-lid 2.4s var(--st) forwards}\n.cc.a-laptop .lap-half{opacity:0;animation:cc-lap-half 2.4s var(--st) forwards}\n.cc.a-laptop .lap-open{opacity:0;animation:cc-lap-open 2.4s var(--st) forwards}\n.cc.a-laptop .lap-hands{opacity:0;animation:cc-lap-base 2.4s var(--st) forwards}\n.cc.a-laptop .hand-l{animation:cc-type .32s var(--st) infinite 2.4s}\n.cc.a-laptop .hand-r{animation:cc-type .32s var(--st) infinite 2.56s}\n.cc.a-laptop .cc-claw-l{animation:cc-lap-cl 2.4s var(--st) forwards!important}\n.cc.a-laptop .cc-claw-r{animation:cc-lap-cr 2.4s var(--st) forwards!important}\n.cc.a-laptop .cc-face{animation:cc-lap-look 2.4s var(--st) forwards}\n.cc.a-laptop.s-idle .cc-body{animation:cc-breathe 2.4s var(--st) infinite}\n@keyframes cc-ember{0%{fill:#FF6A2A}50%{fill:#FFB020}}\n@keyframes cc-type{0%{transform:translateY(0)}50%{transform:translateY(-3px)}}\n@keyframes cc-lap-peek{0%{opacity:0}25%{opacity:1}40%{opacity:0}100%{opacity:0}}\n@keyframes cc-lap-base{0%{opacity:0}40%{opacity:1}100%{opacity:1}}\n@keyframes cc-lap-lid{0%{opacity:1}55%{opacity:0}100%{opacity:0}}\n@keyframes cc-lap-half{0%{opacity:0}55%{opacity:1}70%{opacity:0}100%{opacity:0}}\n@keyframes cc-lap-open{0%{opacity:0}70%{opacity:1}100%{opacity:1}}\n@keyframes cc-lap-glow{0%{opacity:0}70%{opacity:.28}100%{opacity:.28}}\n@keyframes cc-lap-cl{0%{transform:translate(0,0)}40%{transform:translate(30px,46px)}100%{transform:translate(30px,46px)}}\n@keyframes cc-lap-cr{0%{transform:translate(0,0)}12%{transform:translate(-12px,24px)}20%{transform:translate(-30px,46px)}25%{transform:translate(0,3px)}40%{transform:translate(-30px,46px)}100%{transform:translate(-30px,46px)}}\n@keyframes cc-lap-look{0%{transform:translate(0,0)}70%{transform:translate(0,4.5px)}100%{transform:translate(0,4.5px)}}\n';
const SVG='<svg role="img" aria-label="CancriCode 小蟹" width="100%" height="100%" viewBox="-12 -30 168 150">\n<g class="cc-all">\n<g class="acc acc-laptop lap-peek"><rect x="103" y="14" width="22" height="34" rx="2" fill="#D7DBE3" stroke="#8E95A3" stroke-width="3"/><rect x="111" y="28" width="6" height="6" fill="#F2532F"/></g>\n<g class="cc-legs-l"><path class="" d="M12 66h12v6h-12zM12 78h12v6h-12zM18 90h6v6h-6z" fill="var(--crab-shade,#D63B22)" stroke="var(--crab-shade,#D63B22)" stroke-width="3" stroke-linejoin="round"/></g><g class="cc-legs-r"><path class="" d="M120 66h12v6h-12zM120 78h12v6h-12zM120 90h6v6h-6z" fill="var(--crab-shade,#D63B22)" stroke="var(--crab-shade,#D63B22)" stroke-width="3" stroke-linejoin="round"/></g>\n<g class="cc-claw-l"><path class="" d="M24 36h12v6h-12zM24 42h12v6h-12zM24 48h12v6h-12zM24 54h12v6h-12z" fill="var(--crab-shade,#D63B22)" stroke="var(--crab-shade,#D63B22)" stroke-width="3" stroke-linejoin="round"/><g class="cc-open"><path class="" d="M12 0h24v6h-24zM6 6h36v6h-36zM0 12h18v6h-18zM0 18h12v6h-12zM0 24h12v6h-12zM30 24h12v6h-12zM0 30h42v6h-42zM6 36h30v6h-30z" fill="var(--crab,#F2532F)" stroke="var(--crab,#F2532F)" stroke-width="3" stroke-linejoin="round"/></g><g class="cc-shut"><path class="" d="M12 0h24v6h-24zM6 6h36v6h-36zM0 12h42v6h-42zM0 18h42v6h-42zM0 24h42v6h-42zM0 30h42v6h-42zM6 36h30v6h-30z" fill="var(--crab,#F2532F)" stroke="var(--crab,#F2532F)" stroke-width="3" stroke-linejoin="round"/></g></g>\n<g class="cc-claw-r"><path class="" d="M108 36h12v6h-12zM108 42h12v6h-12zM108 48h12v6h-12zM108 54h12v6h-12z" fill="var(--crab-shade,#D63B22)" stroke="var(--crab-shade,#D63B22)" stroke-width="3" stroke-linejoin="round"/><g class="cc-open"><path class="" d="M108 0h24v6h-24zM102 6h36v6h-36zM126 12h18v6h-18zM132 18h12v6h-12zM102 24h12v6h-12zM132 24h12v6h-12zM102 30h42v6h-42zM108 36h30v6h-30z" fill="var(--crab,#F2532F)" stroke="var(--crab,#F2532F)" stroke-width="3" stroke-linejoin="round"/></g><g class="cc-shut"><path class="" d="M108 0h24v6h-24zM102 6h36v6h-36zM102 12h42v6h-42zM102 18h42v6h-42zM102 24h42v6h-42zM102 30h42v6h-42zM108 36h30v6h-30z" fill="var(--crab,#F2532F)" stroke="var(--crab,#F2532F)" stroke-width="3" stroke-linejoin="round"/></g></g>\n<g class="cc-body"><path class="" d="M60 36h24v6h-24zM48 42h48v6h-48zM36 48h72v6h-72zM30 54h84v6h-84zM30 60h84v6h-84zM24 66h96v6h-96zM24 72h96v6h-96zM24 78h96v6h-96zM24 84h96v6h-96zM30 90h84v6h-84zM36 96h72v6h-72zM48 102h48v6h-48z" fill="var(--crab,#F2532F)" stroke="var(--crab,#F2532F)" stroke-width="3" stroke-linejoin="round"/><path class="" d="M30 90h84v6h-84zM36 96h72v6h-72zM48 102h48v6h-48z" fill="var(--crab-shade,#D63B22)" stroke="var(--crab-shade,#D63B22)" stroke-width="3" stroke-linejoin="round"/>\n<g class="cc-look"><g class="cc-face">\n<g class="cc-eyes"><rect x="50" y="56" width="13" height="19" rx="3" fill="var(--crab-eye,#2A1512)"/><rect x="81" y="56" width="13" height="19" rx="3" fill="var(--crab-eye,#2A1512)"/></g>\n<g class="cc-eyes-happy" fill="none" stroke="var(--crab-eye,#2A1512)" stroke-width="4.5" stroke-linecap="square" stroke-linejoin="miter"><path d="M49 72 L56.5 63 L64 72"/><path d="M80 72 L87.5 63 L95 72"/></g>\n<g class="cc-eyes-x" fill="none" stroke="var(--crab-eye,#2A1512)" stroke-width="4" stroke-linecap="square"><path d="M51 59 L62 72 M62 59 L51 72"/><path d="M82 59 L93 72 M93 59 L82 72"/></g>\n<g class="cc-eyes-closed" fill="var(--crab-eye,#2A1512)"><rect x="49" y="66" width="15" height="4.5" rx="1"/><rect x="80" y="66" width="15" height="4.5" rx="1"/></g>\n<rect class="cc-mouth" x="66" y="80" width="12" height="6" rx="1" fill="var(--crab-eye,#2A1512)"/>\n</g></g></g>\n<g class="acc acc-wizard" data-to="body"><path d="M48 28h48v6h-48zM51 22h42v6h-42zM54 16h36v6h-36zM57 10h30v6h-30zM60 4h24v6h-24zM63 -2h18v6h-18zM66 -8h12v6h-12zM69 -14h9v6h-9zM75 -20h9v6h-9zM81 -23h6v6h-6z" fill="#6A3FD0"/><path d="M42 34h60v6h-60z" fill="#4B2A9E"/><path d="M66 16h12v3h-12zM70.5 11.5h3v12h-3z" fill="#FFC83D"/><path d="M81 1h3v3h-3zM60 22h3v3h-3z" fill="#FFE48A"/></g><g class="acc acc-cowboy" data-to="body"><path d="M51 16h42v18h-42zM54 10h15v6h-15zM75 10h15v6h-15z" fill="#A8642F"/><path d="M51 27h42v5h-42z" fill="#3B2414"/><path d="M36 34h72v6h-72zM30 28h9v9h-9zM105 28h9v9h-9z" fill="#7A4520"/></g><g class="acc acc-cap" data-to="body"><path d="M60 16h24v6h-24zM54 22h36v6h-36zM48 28h48v10h-48z" fill="#6A3FD0"/><path d="M69 12h6v4h-6z" fill="#4B2A9E"/><path d="M90 33h28v6h-28z" fill="#4B2A9E"/><path d="M66 23h9v3h-9zM66 23h3v10h-3zM66 30h9v3h-9z" fill="#FFFFFF"/></g><g class="acc acc-glasses" data-to="face"><rect x="46" y="53" width="21" height="23" fill="rgba(170,215,255,.22)" stroke="#1E1B18" stroke-width="3"/><rect x="77" y="53" width="21" height="23" fill="rgba(170,215,255,.22)" stroke="#1E1B18" stroke-width="3"/><path d="M67 60h10v3h-10zM30 57h16v3h-16zM98 57h16v3h-16z" fill="#1E1B18"/><path d="M50 57h3v6h-3zM81 57h3v6h-3z" fill="#FFFFFF" opacity=".85"/></g><g class="acc acc-stache" data-to="face"><path d="M60 79h24v6h-24zM54 82h9v6h-9zM81 82h9v6h-9zM48 76h6v9h-6zM90 76h6v9h-6z" fill="#3A2318"/></g><g class="acc acc-smoke" data-to="face"><path d="M78 82h18v4h-18z" fill="#F4F1EA"/><path d="M78 82h6v4h-6z" fill="#E3B072"/><rect class="ember" x="96" y="82" width="4" height="4" fill="#FF6A2A"/><g fill="#B8B2AA"><rect class="sm1" x="100" y="73" width="3" height="3"/><rect class="sm2" x="104" y="65" width="4" height="4"/><rect class="sm3" x="100" y="56" width="4" height="4"/><rect class="sm4" x="106" y="46" width="5" height="5"/></g></g><g class="acc acc-phone"><rect x="58" y="78" width="28" height="32" rx="3" fill="#1E1B18"/><rect x="61" y="82" width="22" height="24" fill="#7FD0FF"/><g class="scrA" fill="#FFFFFF"><rect x="64" y="85" width="16" height="3"/><rect x="64" y="97" width="11" height="3"/></g><g class="scrB" fill="#FFFFFF"><rect x="64" y="91" width="13" height="3"/><rect x="64" y="103" width="16" height="3"/></g><path d="M52 90h9v12h-9zM83 90h9v12h-9z" fill="#F2532F"/><path d="M52 99h9v3h-9zM83 99h9v3h-9z" fill="#D63B22"/></g><g class="acc acc-laptop"><g class="lap-open"><rect x="44" y="80" width="56" height="20" rx="2" fill="#D7DBE3" stroke="#8E95A3" stroke-width="3"/><rect x="69" y="87" width="6" height="6" fill="#F2532F"/></g><g class="lap-half"><rect x="44" y="89" width="56" height="11" rx="2" fill="#D7DBE3" stroke="#8E95A3" stroke-width="3"/></g><g class="lap-base"><rect x="38" y="100" width="68" height="6" fill="#C9CED8"/><rect x="38" y="106" width="68" height="3" fill="#8E95A3"/><rect class="lap-lid" x="38" y="96" width="68" height="4" fill="#D7DBE3"/></g><g class="lap-hands"><path d="M42 92h12v9h-12z" fill="#F2532F" class="hand-l"/><path d="M90 92h12v9h-12z" fill="#F2532F" class="hand-r"/></g></g>\n<g class="cc-fx-think" fill="var(--crab-fx,var(--crab-eye,#2A1512))"><rect class="d1" x="120" y="-6" width="6" height="6"/><rect class="d2" x="132" y="-15" width="6" height="6"/><rect class="d3" x="144" y="-24" width="6" height="6"/></g>\n<g class="cc-fx-zzz" fill="var(--crab-fx,var(--crab-eye,#2A1512))"><path class="z1" d="M112 -2h12v3l-8 7h8v3h-12v-3l8-7h-8z"/><path class="z2" d="M128 -18h9v2.5l-6 5h6v2.5h-9v-2.5l6-5h-6z"/></g>\n<g class="cc-fx-spark" fill="var(--crab-spark,#FFB020)"><path class="s1" d="M-4 30h6v-6h3v6h6v3h-6v6h-3v-6h-6z"/><path class="s2" d="M137 24h6v-6h3v6h6v3h-6v6h-3v-6h-6z"/><path class="s3" d="M66 -18h4v-4h3v4h4v3h-4v4h-3v-4h-4z"/></g>\n</g>\n</svg>';
const ACTION_STATES=["smoke","phone","laptop","headphones","gun","heart","sweat","question","hearts","bubble","dumbbell","chicken","money"];
const STATES=["idle","think","talk","work","happy","error","sleep","crazy","sulk",...ACTION_STATES];
const ACCS=["wizard","cowboy","cap","glasses","stache","magnifier","coffee","crown","bling","santa","birthday","zongzi","mooncake","baton"];
const EXTRA_CSS=`
.cc .new-face{display:none}
.cc.s-crazy .cc-eyes,.cc.s-sulk .cc-eyes{display:none}
.cc.s-crazy .face-crazy,.cc.s-sulk .face-sulk{display:inline}
.cc.s-crazy .cc-all{animation:cc-mad .32s steps(2,end) infinite}
.cc.s-crazy .cc-claw-l{animation:cc-wave .24s steps(2,end) infinite alternate}
.cc.s-crazy .cc-claw-r{animation:cc-wave .24s steps(2,end) infinite alternate-reverse}
.cc.s-sulk .cc-face{transform:translate(-9px,3px)}
.cc.s-sulk .cc-claw-l{transform:translate(15px,42px) rotate(-25deg)}
.cc.s-sulk .cc-claw-r{transform:translate(-15px,42px) rotate(25deg)}
.cc.s-sulk .cc-all{animation:cc-huff 2.4s var(--st) infinite}
${[...ACCS,...ACTION_STATES].map(a=>`.cc.a-${a} .acc-${a}{display:inline}`).join('\n')}
.cc.s-laptop .cc-body{animation:cc-breathe 2.4s var(--st) infinite}
.cc.s-headphones .cc-eyes{display:none}
.cc.s-headphones .cc-eyes-happy{display:inline}
.cc.a-headphones .cc-all{animation:cc-dance .8s steps(2,end) infinite}
.cc .note{animation:cc-float 1.6s steps(4,end) infinite}
.cc .note.second{animation-delay:-.8s}
.cc .drop{animation:cc-drip 1.4s steps(4,end) infinite}
.cc .coffee-steam{animation:cc-float 2s steps(4,end) infinite}
.cc .love-puff{animation:cc-love 2s steps(5,end) infinite;transform-origin:72px 30px}
.cc .love-puff.second{animation-delay:-1s}
.cc.a-heart .cc-claw-l{animation:cc-heart-l 1.8s steps(3,end) infinite}
.cc.a-heart .cc-claw-r{animation:cc-heart-r 1.8s steps(3,end) infinite}
.cc.a-heart .hand-heart{animation:cc-heart-pop 1.8s var(--st) infinite}
.cc .baton-stick{transform-origin:126px 27px;animation:cc-conduct .8s steps(3,end) infinite}
.cc .cc-gun-rig{transform-origin:114px 60px}
.cc.a-gun .cc-claw-r,.cc.a-gun .cc-gun-rig{animation:cc-gun-hand 4.8s steps(3,end) forwards!important}
.cc .revolver{transform-origin:120px 28px;animation:cc-gun 4.8s steps(4,end) forwards}
.cc .gun-flash,.cc .gun-smoke,.cc .gun-blow{opacity:0}
.cc .gun-flash{animation:cc-gun-flash 4.8s steps(1,end) forwards}
.cc .gun-smoke{animation:cc-gun-smoke 4.8s steps(4,end) forwards}
.cc .gun-blow{animation:cc-gun-blow 4.8s steps(1,end) forwards}
.cc.a-gun .cc-face{animation:cc-gun-face 4.8s var(--st) forwards!important}
.cc.a-gun .cc-all{animation:cc-gun-body 4.8s var(--st) forwards}
.cc .gum{transform-origin:72px 86px;animation:cc-gum 3s steps(6,end) infinite}
.cc .gum-pop{opacity:0;animation:cc-gum-pop 3s steps(1,end) infinite}
.cc.a-bubble .cc-eyes{animation:cc-gum-eyes 3s steps(1,end) infinite!important;transform-origin:72px 66px}
.cc.a-dumbbell .cc-eyes,.cc.a-dumbbell .cc-eyes-happy,.cc.a-dumbbell .cc-eyes-x,.cc.a-dumbbell .cc-eyes-closed,.cc.a-dumbbell .new-face,.cc.a-dumbbell .cc-mouth{display:none!important}
.cc.a-dumbbell .cc-claw-l{animation:cc-lift 1.2s steps(2,end) infinite!important}
.cc.a-dumbbell .cc-claw-r{animation:cc-lift 1.2s steps(2,end) infinite -.6s!important}
.cc.a-dumbbell .cc-all{animation:cc-strain .15s steps(2,end) infinite}
.cc .strain-drop{animation:cc-drip 1.2s steps(4,end) infinite}
.cc .chick{transform-origin:120px 45px;animation:cc-squeeze 1s steps(1,end) infinite}
.cc .beak-open,.cc .squawk{opacity:0;animation:cc-squawk 1s steps(1,end) infinite}
.cc .beak{animation:cc-squawk-off 1s steps(1,end) infinite}
.cc.a-chicken .cc-claw-r{animation:cc-squeeze-hand 1s steps(1,end) infinite!important}
.cc.a-chicken .cc-all{animation:cc-flinch 1s steps(1,end) infinite}
.cc.a-money .cc-eyes,.cc.a-money .cc-eyes-happy,.cc.a-money .cc-eyes-x,.cc.a-money .cc-eyes-closed,.cc.a-money .new-face{display:none!important}
.cc.a-money .cc-all{animation:cc-jump 1.2s var(--st) infinite}
.cc.a-money .cc-claw-r{animation:cc-make-rain .4s steps(1,end) infinite!important}
.cc .bill{opacity:0;animation:cc-bill 1.2s steps(5,end) infinite}
.cc .bill.b2{animation-delay:-.4s}.cc .bill.b3{animation-delay:-.8s}
@keyframes cc-mad{0%,100%{transform:translate(-3px,0) rotate(-4deg)}50%{transform:translate(3px,-3px) rotate(4deg)}}
@keyframes cc-wave{from{transform:rotate(-25deg)}to{transform:rotate(25deg) translateY(-9px)}}
@keyframes cc-huff{0%,80%,100%{transform:translateX(0)}85%{transform:translateX(-3px)}90%{transform:translateX(3px)}}
@keyframes cc-dance{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg) translateY(-3px)}}
@keyframes cc-float{0%{opacity:0;transform:translateY(9px)}25%,70%{opacity:1}100%{opacity:0;transform:translateY(-12px)}}
@keyframes cc-drip{0%{opacity:0;transform:translateY(-6px)}25%{opacity:1}100%{opacity:0;transform:translateY(21px)}}
@keyframes cc-love{0%{opacity:0;transform:translateY(12px) scale(.5)}25%{opacity:1}100%{opacity:0;transform:translateY(-24px) scale(1)}}
@keyframes cc-heart-l{0%,100%{transform:translate(0,0)}30%,75%{transform:translate(36px,48px) rotate(-15deg)}}
@keyframes cc-heart-r{0%,100%{transform:translate(0,0)}30%,75%{transform:translate(-36px,48px) rotate(15deg)}}
@keyframes cc-heart-pop{0%,100%{opacity:0}30%,75%{opacity:1}}
@keyframes cc-conduct{0%,100%{transform:rotate(-25deg)}50%{transform:rotate(30deg)}}
@keyframes cc-gun-hand{0%{transform:translate(-6px,48px)}8%{transform:translate(0,-9px)}12%{transform:translate(0,0)}22%{transform:translate(0,-3px)}30%{transform:translate(0,0)}38%{transform:translate(0,-3px)}46%{transform:translate(0,0)}52%,57%{transform:translate(6px,-3px)}58%{transform:translate(6px,-6px) rotate(-22deg)}62%,65%{transform:translate(6px,-3px)}66%{transform:translate(6px,-6px) rotate(-22deg)}70%{transform:translate(6px,-3px)}76%,94%{transform:translate(-18px,36px)}100%{transform:translate(0,0)}}
@keyframes cc-gun{0%,5%{opacity:0;transform:rotate(0deg)}6%,14%{opacity:1;transform:rotate(0deg)}22%{transform:rotate(360deg)}30%{transform:rotate(720deg)}38%{transform:rotate(1080deg)}46%,70%{transform:rotate(1440deg)}76%,94%{transform:rotate(1350deg)}100%{opacity:1;transform:rotate(1440deg)}}
@keyframes cc-gun-flash{0%{opacity:0}58%{opacity:1}61%{opacity:0}66%{opacity:1}69%,100%{opacity:0}}
@keyframes cc-gun-smoke{0%,74%{opacity:0;transform:translateY(6px)}78%{opacity:1;transform:translateY(0)}94%{opacity:.6;transform:translateY(-9px)}100%{opacity:0;transform:translateY(-12px)}}
@keyframes cc-gun-blow{0%{opacity:0}80%{opacity:1}94%,100%{opacity:0}}
@keyframes cc-gun-face{0%,48%{transform:translate(0,0)}52%,72%{transform:translate(4.5px,0)}76%,94%{transform:translate(6px,-3px)}100%{transform:translate(0,0)}}
@keyframes cc-gun-body{0%,57%{transform:translateX(0)}58%{transform:translateX(-4.5px)}62%,65%{transform:translateX(0)}66%{transform:translateX(-4.5px)}70%,100%{transform:translateX(0)}}
@keyframes cc-gum{0%{transform:scale(.1)}70%{transform:scale(1.5)}72%,100%{transform:scale(0)}}
@keyframes cc-gum-pop{0%{opacity:0}72%{opacity:1}84%,100%{opacity:0}}
@keyframes cc-gum-eyes{0%{transform:scaleY(1)}55%{transform:scaleY(.4)}72%{transform:scale(1.25,1.15)}88%,100%{transform:scaleY(1)}}
@keyframes cc-lift{0%{transform:translateY(9px)}50%{transform:translateY(-6px)}}
@keyframes cc-strain{0%{transform:translateX(-1.5px)}50%{transform:translateX(1.5px)}}
@keyframes cc-squeeze{0%{transform:scale(1)}40%{transform:scale(1.12,.7)}60%{transform:scale(1)}}
@keyframes cc-squawk{0%{opacity:0}40%{opacity:1}60%,100%{opacity:0}}
@keyframes cc-squawk-off{0%{opacity:1}40%{opacity:0}60%,100%{opacity:1}}
@keyframes cc-squeeze-hand{0%{transform:translate(0,0)}40%{transform:translate(0,6px)}60%{transform:translate(0,0)}}
@keyframes cc-flinch{0%{transform:translate(0,0)}40%{transform:translate(-3px,-6px) rotate(-3deg)}60%{transform:translate(0,0)}}
@keyframes cc-make-rain{0%{transform:translate(0,0)}50%{transform:translate(-3px,-6px) rotate(-12deg)}}
@keyframes cc-bill{0%{opacity:1;transform:translate(0,0) rotate(0deg)}40%{opacity:1;transform:translate(-24px,-30px) rotate(-30deg)}100%{opacity:0;transform:translate(-60px,6px) rotate(-90deg)}}
/* ▼ CANCRI PATCH：思考点与 zzz 画在身体外、落在页面底色上，改走 --crab-fx（默认仍是眼睛色），深色主题由宿主页面覆盖，见 crab-personalize.css */
/* ▼ CANCRI PATCH：动作状态占用头顶 / 双钳时，先收起同部位的用户装饰，不然帽子和问号、耳机叠在一起，钳子里的咖啡和手机、电脑叠在一起 */
.cc:is(.s-question,.s-headphones,.s-hearts) :is(.acc-wizard,.acc-cowboy,.acc-cap,.acc-crown,.acc-santa,.acc-birthday[data-to="body"]){display:none!important}
.cc:is(.s-phone,.s-laptop,.s-heart,.s-dumbbell,.s-chicken,.s-money,.s-gun) :is(.acc-magnifier,.acc-coffee,.acc-baton,.acc-zongzi,.acc-mooncake,.acc-birthday[data-to="clawR"]){display:none!important}
@media(prefers-reduced-motion:reduce){.cc *{animation:none!important}.cc .revolver,.cc .hand-heart{opacity:1}.cc .gum{transform:scale(.8)}}
`;
const heartPath='M0 3h3V0h6v3h3V0h6v3h3v6h-3v3h-3v3h-3v3H9v-3H6v-3H3V9H0z';
const EXTRA_SVG=`
<g class="acc acc-headphones" data-to="body" fill="#292B42"><path d="M42 57V33h6v-6h48v6h6v24h-6V36H48v21z"/><path fill="#8C70EC" d="M39 48h12v24H39zM93 48h12v24H93z"/><g fill="#8C70EC" class="note"><path d="M12 -12h18v6H18v18h-9V6h6V-6h-3z"/></g><g fill="#38B6AD" class="note second"><path d="M117 -15h18v6h-12V9h-9V3h6V-9h-3z"/></g></g>
<g class="acc acc-gun" data-to="gun"><g class="revolver"><path fill="#493225" d="M114 24h12v21h-9v-9h-3z"/><path fill="#333844" d="M108 12h39v12h-21v9h-15v-6h9v-3h-12z"/><path fill="#B7C5CC" d="M108 12h36v6h-36z"/><path fill="#77868E" d="M111 18h12v9h-12z"/><path fill="#E6BA64" d="M117 33h6v6h-6z"/><g class="gun-flash"><path fill="#FFB020" d="M147 6h6v6h-6zM150 15h12v6h-12zM147 24h6v6h-6zM156 3h3v3h-3zM156 30h3v3h-3z"/><path fill="#FFF2B0" d="M147 15h6v6h-6z"/></g></g><g class="gun-smoke" fill="#C9CCD2"><rect class="p1" x="107" y="-6" width="5" height="5"/><rect class="p2" x="110" y="-16" width="6" height="6"/><rect class="p3" x="105" y="-27" width="7" height="7"/></g></g>
<g class="acc acc-gun" data-to="face"><g class="gun-blow"><rect x="69" y="80" width="6" height="6" rx="1" fill="var(--crab-eye,#2A1512)"/><path fill="#ABD9DF" d="M80 74h4v3h-4zM84 62h4v3h-4zM88 50h4v3h-4z"/></g></g>
<g class="acc acc-heart"><path class="hand-heart" transform="translate(61 72)" fill="#FF92B4" d="${heartPath}"/></g>
<g class="acc acc-sweat" data-to="face" fill="#69CDE9"><path class="drop" d="M102 45h3v6h3v9h-9v-9h3z"/></g>
<g class="acc acc-magnifier" data-to="clawL"><path fill="#825633" d="M18 27h6v27h-6z"/><path fill="#343F53" d="M9 0h24v6h6v21h-6v6H9v-6H3V6h6z"/><path fill="#A9DFEB" d="M12 6h18v3h3v15h-3v3H12v-3H9V9h3z"/><path fill="#E7FBFF" d="M12 9h9v3h-6v9h-3z"/></g>
<g class="acc acc-coffee" data-to="clawR"><path fill="#754F35" d="M111 12h24v6h12v18h-12v6h-24z"/><path fill="#F7E3BC" d="M114 18h18v21h-18zM135 21h6v9h-6z"/><path fill="#70452B" d="M114 15h18v6h-18z"/><path class="coffee-steam" fill="#B6B8BE" d="M117 -3h3v9h-3zM126 -9h3V3h-3z"/></g>
<g class="acc acc-crown" data-to="body"><path fill="#E9AA25" d="M45 15h9v9h12V12h12v12h12v-9h9v27H45z"/><path fill="#FFE07A" d="M45 36h54v6H45z"/><path fill="#EE5379" d="M69 27h6v6h-6z"/></g>
<g class="acc acc-bling" data-to="face"><path fill="#252332" d="M42 54h27v6h6v-6h27v18H78v-9H66v9H42z"/><path fill="#657888" d="M45 57h9v3h-9zM81 57h9v3h-9z"/></g>
<g class="acc acc-bling" data-to="body"><path fill="none" stroke="#F1C44C" stroke-width="4" d="M39 84v9h9v6h48v-6h9v-9"/><path fill="#FFD96A" d="M66 96h12v12H66z"/></g>
<g class="acc acc-question" data-to="body" fill="#8E73DC"><path d="M63 -12h18v6h6V6h-6v6h-6v6h-6V6h6V0h6v-6H63v6h-6v-6h6zM69 24h6v6h-6z"/></g>
<g class="acc acc-santa" data-to="body"><path fill="#D83C4B" d="M42 33h60V21h-9V9H75V0H57v12h-9v9h-6z"/><path fill="#FFF0DD" d="M39 30h66v12H39zM72 0h12v12H72z"/></g>
<g class="acc acc-birthday" data-to="body"><path fill="#9572D8" d="M69 -12h6V0h6v12h6v12h6v12H51V24h6V12h6V0h6z"/><path fill="#F8D465" d="M69 -18h6v6h-6zM63 9h6v6h-6zM75 24h6v6h-6z"/></g>
<g class="acc acc-birthday" data-to="clawR"><path fill="#F1ACBC" d="M108 18h36v24h-36z"/><path fill="#FFF0D4" d="M105 18h42v6h-42zM105 42h42v6h-42z"/><path fill="#6EBCCA" d="M123 6h6v12h-6z"/><path fill="#FFB43F" d="M123 0h6v6h-6z"/></g>
<g class="acc acc-zongzi" data-to="clawR"><path fill="#397D4A" d="M120 3h6v6h6v9h6v9h6v12h-39V27h6V15h6V9h3z"/><path fill="#63A05A" d="M117 15h6v9h6v9h-18v-6h6z"/><path fill="#EFDBA1" d="M108 27h30v3h-30zM123 9h3v30h-3z"/></g>
<g class="acc acc-mooncake" data-to="clawR"><path fill="#B97830" d="M111 6h24v6h6v24h-6v6h-24v-6h-6V12h6z"/><path fill="#EDB35A" d="M114 12h18v3h3v18h-3v3h-18v-3h-3V15h3z"/><path fill="none" stroke="#B97830" stroke-width="3" d="M117 18h12v12h-12zM123 15v18M114 24h18"/></g>
<g class="acc acc-baton" data-to="clawR"><g class="baton-stick"><path fill="#F4E6CF" d="M123 -18h3v45h-3z"/><path fill="#453742" d="M120 21h9v15h-9z"/></g></g>
<g class="acc acc-hearts" data-to="body" fill="#F778A2"><g class="love-puff"><path transform="translate(42 9)" d="${heartPath}"/></g><g class="love-puff second"><path transform="translate(84 0)" d="${heartPath}"/></g></g>
<g class="acc acc-bubble" data-to="face"><rect x="68" y="83" width="8" height="5" fill="#FF8DC7"/><g class="gum"><circle cx="72" cy="86" r="10" fill="#FF8DC7"/><rect x="66" y="81" width="4" height="4" fill="#FFD0E8"/></g><g class="gum-pop" fill="#FF8DC7"><path d="M54 80h6v3h-6zM84 80h6v3h-6zM58 92h4v4h-4zM82 92h4v4h-4zM70 97h4v4h-4zM62 74h3v3h-3zM80 74h3v3h-3z"/></g></g>
<g class="acc acc-dumbbell" data-to="clawL"><path fill="#9AA3AE" d="M3 18h36v6h-36z"/><path fill="#3A3F4A" d="M-6 9h9v24h-9zM39 9h9v24h-9z"/></g><g class="acc acc-dumbbell" data-to="clawR"><path fill="#9AA3AE" d="M105 18h36v6h-36z"/><path fill="#3A3F4A" d="M96 9h9v24h-9zM141 9h9v24h-9z"/></g>
<g class="acc acc-dumbbell" data-to="face"><g fill="none" stroke="var(--crab-eye,#2A1512)" stroke-width="4.5" stroke-linecap="square"><path d="M50 59 L62 66 L50 73"/><path d="M94 59 L82 66 L94 73"/></g><path fill="var(--crab-eye,#2A1512)" d="M63 82h18v3h-18z"/><path class="strain-drop" fill="#69CDE9" d="M40 50h3v4h3v6h-9v-6h3z"/></g>
<g class="acc acc-chicken" data-to="clawR"><g class="chick"><path fill="#FFD23F" d="M108 12h24v18h-24zM111 30h18v6h-18zM129 0h12v15h-12z"/><path fill="#E8443A" d="M132 -6h6v6h-6z"/><path fill="#1E1B18" d="M135 3h3v3h-3z"/><path fill="#FF9F1C" d="M114 36h3v9h-3zM123 36h3v9h-3z"/><path class="beak" fill="#FF9F1C" d="M141 6h9v4h-9z"/><path class="beak-open" fill="#FF9F1C" d="M141 1h10v3h-10zM141 10h10v3h-10z"/></g><g class="squawk" fill="#E8443A"><path d="M138 -28h4v10h-4zM138 -15h4v4h-4zM146 -30h4v10h-4zM146 -17h4v4h-4z"/></g></g>
<g class="acc acc-money" data-to="face"><path fill="#2FA84F" d="M51 59h11v3h-8v4h8v7h-11v-3h8v-4h-8zM55 56h3v19h-3zM82 59h11v3h-8v4h8v7h-11v-3h8v-4h-8zM86 56h3v19h-3z"/></g><g class="acc acc-money" data-to="clawR"><path fill="#2FA84F" d="M108 15h27v15h-27z"/><path fill="#A8E0A0" d="M117 19h9v7h-9z"/><g class="bill b1"><path fill="#2FA84F" d="M120 6h15v9h-15z"/><path fill="#A8E0A0" d="M125 8h5v5h-5z"/></g><g class="bill b2"><path fill="#2FA84F" d="M120 6h15v9h-15z"/><path fill="#A8E0A0" d="M125 8h5v5h-5z"/></g><g class="bill b3"><path fill="#2FA84F" d="M120 6h15v9h-15z"/><path fill="#A8E0A0" d="M125 8h5v5h-5z"/></g></g>
`;
const EXTRA_FACE=`<g class="new-face face-crazy" fill="none" stroke="var(--crab-eye,#2A1512)" stroke-width="3"><path d="M48 57h18v18H51V60h12v12h-9v-6h6M81 57h18v18H84V60h12v12h-9v-6h6M57 81v9h30v-9M63 84v6m9-6v6m9-6v6"/></g><g class="new-face face-sulk" fill="var(--crab-eye,#2A1512)"><path d="M48 57h6v3h12v6H54v-3h-6zM81 60h12v-3h6v6h-6v3H81zM54 69h12v3H54zM81 69h12v3H81zM69 84h12v3H69z"/></g>`;
class CancriCrab extends HTMLElement{
  static get observedAttributes(){return ["state","accessory"];}
  constructor(){
    super();
    const root=this.attachShadow({mode:"open"});
    root.innerHTML="<style>:host{display:inline-block;aspect-ratio:168/150}"+CSS+"</style><div class=\"cc js-blink\" style=\"width:100%;height:100%\">"+SVG+"</div>";
    this.$=root.querySelector(".cc"); this.$look=root.querySelector(".cc-look"); this.$svg=root.querySelector("svg");
    root.querySelector("style").textContent+=EXTRA_CSS;
    this.$svg.querySelector(".cc-all").insertAdjacentHTML("beforeend",EXTRA_SVG);
    this.$svg.querySelector(".cc-face").insertAdjacentHTML("beforeend",EXTRA_FACE);
    // 装饰挂到对应部件的组里，跟随该部件的动画；枪单独一个与右钳同步的组，画在身体上层
    const all=this.$svg.querySelector(".cc-all"),rig=document.createElementNS("http://www.w3.org/2000/svg","g");
    rig.setAttribute("class","cc-gun-rig");all.appendChild(rig);
    const to={body:".cc-body",face:".cc-face",clawL:".cc-claw-l",clawR:".cc-claw-r"};
    this.$svg.querySelectorAll("[data-to]").forEach(el=>{const d=el.getAttribute("data-to");(d==="gun"?rig:this.$svg.querySelector(to[d])).appendChild(el);});
    this._onMove=this._onMove.bind(this);
  }
  connectedCallback(){this._apply();window.addEventListener("pointermove",this._onMove,{passive:true});this._scheduleBlink();}
  disconnectedCallback(){window.removeEventListener("pointermove",this._onMove);clearTimeout(this._bt);}
  attributeChangedCallback(){this._apply();}
  get state(){return this.getAttribute("state")||"idle";}
  set state(v){this.setAttribute("state",v);}
  /** 临时切换状态，ms 后回到之前的状态（比如任务完成 happy 1.5 秒） */
  flash(s,ms=1500){const prev=this.state;this.state=s;clearTimeout(this._ft);this._ft=setTimeout(()=>{this.state=prev;},ms);}
  _apply(){
    if(!this.$)return; const s=STATES.includes(this.state)?this.state:"idle";
    STATES.forEach(x=>this.$.classList.toggle("s-"+x,x===s));
    const acc=(this.getAttribute("accessory")||"").split(/\s+/).filter(Boolean);
    ACCS.forEach(a=>this.$.classList.toggle("a-"+a,acc.includes(a)));
    // 动作沿用已有图层和动画类，但只由单选 state 驱动，不接受 accessory 叠加。
    ACTION_STATES.forEach(a=>this.$.classList.toggle("a-"+a,a===s));
    if(s!=="idle"&&this.$look)this.$look.removeAttribute("transform");
  }
  _onMove(e){
    if(this.getAttribute("follow")==="off"||this.state!=="idle")return;
    const r=this.$svg.getBoundingClientRect(); if(!r.width)return;
    const cx=r.left+r.width*0.5, cy=r.top+r.height*0.62;
    const nx=Math.max(-1,Math.min(1,(e.clientX-cx)/(r.width*1.5)));
    const ny=Math.max(-1,Math.min(1,(e.clientY-cy)/(r.height*1.5)));
    // 量化到 1.5 单位一档，保持像素感
    const q=v=>Math.round(v*3)*1.5;
    this.$look.setAttribute("transform","translate("+q(nx)+" "+q(ny)*0.67+")");
  }
  _scheduleBlink(){
    // 2.5~6 秒随机眨眼，20% 概率连眨两下
    const wait=2500+Math.random()*3500;
    this._bt=setTimeout(()=>{
      const blink=()=>{this.$.classList.add("blinking");setTimeout(()=>this.$.classList.remove("blinking"),110);};
      blink(); if(Math.random()<0.2)setTimeout(blink,220);
      this._scheduleBlink();
    },wait);
  }
}
if(!customElements.get("cancri-crab"))customElements.define("cancri-crab",CancriCrab);
})();
