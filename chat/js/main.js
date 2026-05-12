import { initSidebarWorkbench } from './ui/sidebar.js';
import { initThemeBridge } from './ui/theme.js';
import * as fileAttachments from './services/fileAttachments.js';
import { getTools } from './services/tools.js';

initSidebarWorkbench();
initThemeBridge();

window.NexusWorkbench = {
  fileAttachments,
  getTools,
};

document.documentElement.dataset.workbench = 'nexusv-arena';
