export function getTools({ articleSearch = true, webSearch = false } = {}, definitions = {}) {
  const tools = [];

  if (articleSearch && Array.isArray(definitions.articleTools)) {
    tools.push(...definitions.articleTools);
  }

  if (webSearch) {
    if (definitions.webSearchTool) tools.push(definitions.webSearchTool);
    if (definitions.fetchWebPageTool) tools.push(definitions.fetchWebPageTool);
  }

  return tools;
}

