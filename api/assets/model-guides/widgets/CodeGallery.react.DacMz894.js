import { t as runtime } from "./jsx-runtime.CWLBoBiw.js";
import { t as Gallery } from "./Gallery.react.wuwb2_9O.js?v=20261123b";

const { jsx } = runtime();
const examples = [
  ["ocean-wave-simulation-5.2", "海浪模拟", "5454b568aba7db5e7d47.png", "做一个单页海浪模拟。绘制连贯的动画，可调整风速、浪高和光线。界面保持安静，降低动态效果时仍可操作全部参数。"],
  ["brutalist-dev-landing-page-5.2", "开发者平台首页", "0c222d1f36735356bdb2.png", "用单个 HTML 页面做开发者平台首页。采用黑白排版、清晰网格和锋利边角；提供入口、终端演示、可复制的代码示例和价格表。确保键盘可访问并适配移动端。"],
  ["solar-system-explorer-5.2", "太阳系浏览器", "bc98c6a2d416ef0c8f14.png", "做一个单页太阳系浏览器。允许点击行星查看信息、调整轨道速度、拖动旋转和缩放。采用暗色主题，不能只依赖鼠标操作。"],
  ["customer-journey-flow-5.2", "客户旅程流程图", "18145db7e5c89a53b5ff.png", "用单页展示客户从了解产品到购买的路径。允许编辑各阶段并拖动连接线，提供键盘可用的替代操作。"],
  ["asteroid-game-5.2", "小行星游戏", "b674e4c3fda295c15e2a.png", "做一个二维飞船游戏。提供移动、躲避小行星、得分和重开机制；说明运行方式，并分别验证键盘与触屏控制。"],
  ["employee-skills-matrix-5.2", "团队技能矩阵", "88624134c380e875e14c.png", "构建一个展示团队技能覆盖情况的页面。技能和成员交叉排列，可标记熟练度、筛选并查看覆盖缺口；不要只用颜色表示状态。"],
  ["virtual-drum-kit-5.2", "虚拟鼓组", "d90609e53a767d66b5f0.png", "做一个可以用键盘或点击演奏的鼓组。提供多种鼓声、录制与回放；触屏上的鼓垫要够大，并提供清晰的反馈。"],
  ["camping-gear-checklist-5.2", "露营装备清单", "0c58ac635b240bfde0f8.png", "做一个露营装备清单。支持勾选、添加装备、计算总重量，并在本机保存清单；手机上应能快速操作。"],
  ["weather-theatre-5.2", "天气剧场", "d5b10a10abe550c00b76.png", "用 React 和 Canvas 做一个天气剧场。用同一套示例天气数据演示三种氛围；提供昼夜切换、适度的舞台动画和减少动效选项，不接外部 API。"],
  ["typing-rain-5.2", "打字雨", "6688fbf7cad2d2adebb8.png", "制作一个打字练习页面。让词语逐渐落下，用户在它们触底前输入；提供难度、准确率、得分和重新开始。"],
  ["holiday-card-for-kids-5.2", "互动节日贺卡", "ea08e4cb5e4b991c41d9.png", "做一个互动节日贺卡。允许拖放或通过键盘放置装饰，并可独立关闭音效和雪花动画。"],
  ["cloud-painter", "云朵画板", "00a1c73e3f303527ce00.png", "做一个柔和的天空画板。提供多个画笔形状、可暂停的云朵漂浮效果，以及把画作保存成图片的功能。"],
  ["audio-step-sequencer", "音频步进音序器", "865895408875795cfc2c.png", "使用 Web Audio API 制作 16 步节奏网格。允许调整速度和摇摆节奏、保存节拍并导出音频；首次播放由用户手势触发。"],
  ["farewell-message-board", "告别留言板", "658ea84c546d29ce9bbe.png", "制作一个留言板，展示几张带照片与署名的示例留言卡。提供新增入口、长度校验和清楚的成功状态；图片不能抢过文字内容。"],
  ["csv-to-charts", "CSV 图表工具", "fc031aaca2cfd3c12648.png", "做一个在本地读取 CSV 的页面。提供图表类型选择、颜色设置和导出；对空文件、缺列以及无法解析的值显示可读提示。"],
  ["espresso", "咖啡订阅落地页", "598cd8f2a27e196d50a8.png", "为咖啡爱好者做一个订阅落地页，解释设备、课程和计划价格。用实拍风格的图像参考和清晰的行动入口展示服务，无需外部请求。"],
].map(([id, title, file, prompt]) => ({ id, title, prompt, poster: `/api/assets/model-guides/img/${file}` }));

export function t() {
  return jsx(Gallery, { examples, type: "code" });
}
