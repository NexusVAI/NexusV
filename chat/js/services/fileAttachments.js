const DEFAULT_MAX_ATTACHMENT_COUNT = 4;
const DEFAULT_MAX_ATTACHMENT_SIZE = 8 * 1024 * 1024;
// 2026-09-13：pdf/doc/docx 从「文本附件」里摘除。它们是二进制容器，
// FileReader.readAsText 只会解出一整份乱码 —— 实测一个 ~3MB 的 PDF 变成
// ~129 万 token 的请求：模型答不出、按输入估费扣钱、页面挂到 110s 空闲超时。
// 需要 PDF/Word 里的内容时，请用户先转成图片（走视觉/OCR）或 .txt。
const TEXT_ATTACHMENT_RE = /\.(txt|md|json|csv)$/i;
// 命中这些扩展名时给**专门**的提示，而不是笼统的「不支持的文件」——
// 用户最常见的动作就是把 PDF/Word 拖进来，得告诉他为什么不行、怎么才行。
const BINARY_ATTACHMENT_RE = /\.(pdf|doc|docx|ppt|pptx|xls|xlsx)$/i;
// 单份文本附件的字符上限（≈40 万 token 估算）。这条是防「意外巨物」的兜底，
// 正常文本文件远达不到；没有它，一个 8MB 的日志文件会直接变成 ¥3+ 的请求。
const MAX_TEXT_ATTACHMENT_CHARS = 1_000_000;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

export function isSupportedAttachment(file) {
  if (!file) return false;
  const type = String(file.type || '');
  return type.startsWith('image/') || type.startsWith('video/') || TEXT_ATTACHMENT_RE.test(String(file.name || ''));
}

export async function filesToAttachments(files, currentAttachments = [], options = {}) {
  const maxCount = options.maxCount || DEFAULT_MAX_ATTACHMENT_COUNT;
  const maxSize = options.maxSize || DEFAULT_MAX_ATTACHMENT_SIZE;
  const onWarning = typeof options.onWarning === 'function' ? options.onWarning : () => {};
  const allowText = options.allowText !== false;
  const allowVideo = options.allowVideo === true;
  const remainingSlots = Math.max(0, maxCount - currentAttachments.length);
  const accepted = [];

  if (!remainingSlots) {
    onWarning(`最多只能上传 ${maxCount} 个文件`);
    return accepted;
  }

  const fileList = Array.from(files || []);
  if (fileList.length > remainingSlots) {
    onWarning(`最多只能再上传 ${remainingSlots} 个文件`);
  }

  for (const file of fileList.slice(0, remainingSlots)) {
    const type = String(file.type || '');
    const isImage = type.startsWith('image/');
    const isVideo = type.startsWith('video/');
    const isTextFile = TEXT_ATTACHMENT_RE.test(String(file.name || ''));

    if (!isImage && !(allowVideo && isVideo) && !(allowText && isTextFile)) {
      onWarning(
        BINARY_ATTACHMENT_RE.test(String(file.name || ''))
          ? `暂不支持 ${file.name}：PDF/Word 等二进制文件会被读成乱码，请转成图片或 .txt / .md 后再传。`
          : `已忽略不支持的文件：${file.name}`,
      );
      continue;
    }

    if (file.size > maxSize) {
      onWarning(`文件过大，已忽略：${file.name}`);
      continue;
    }

    const attachment = {
      name: file.name,
      type: file.type,
      size: file.size,
      previewUrl: null,
      dataUrl: null,
      textContent: null,
      file,
      isTextFile,
      isVideo,
    };

    if (isImage || isVideo) {
      attachment.previewUrl = URL.createObjectURL(file);
      attachment.dataUrl = await readFileAsDataUrl(file).catch(() => '');
    } else {
      attachment.textContent = await readFileAsText(file).catch(() => '');
      if (!attachment.textContent) {
        onWarning(`无法读取文件内容：${file.name}`);
        continue;
      }
      if (attachment.textContent.length > MAX_TEXT_ATTACHMENT_CHARS) {
        onWarning(
          `文件内容过大（约 ${Math.round(attachment.textContent.length / 10000)} 万字符），已忽略：${file.name}。请拆分或压缩后再传。`,
        );
        continue;
      }
    }

    accepted.push(attachment);
  }

  return accepted;
}

export function attachmentToUserContent(query, attachments = []) {
  const textPart = String(query || '').trim();
  const content = [];
  const hasImageAttachment = attachments.some(item => !item?.isTextFile && !item?.isVideo);

  attachments.forEach(item => {
    if (item?.isTextFile && item?.textContent) {
      content.push({ type: 'text', text: `\n\n--- 附件：${item.name} ---\n${item.textContent}\n--- 附件结束 ---\n` });
      return;
    }
    if (item?.isVideo) return;

    const url = item?.dataUrl || item?.url;
    if (typeof url !== 'string' || !(url.startsWith('data:') || /^https?:\/\//i.test(url))) return;
    content.push({ type: 'image_url', image_url: { url, detail: 'auto' } });
  });

  if (textPart) {
    content.push({ type: 'text', text: textPart });
  } else if (hasImageAttachment) {
    content.push({ type: 'text', text: '请先仔细查看我上传的图片，再结合问题回答。' });
  }

  return content;
}

export function cleanupAttachments(attachments = []) {
  attachments.forEach(item => {
    if (item?.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(item.previewUrl);
    }
  });
}

