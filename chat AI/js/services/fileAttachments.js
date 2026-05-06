const DEFAULT_MAX_ATTACHMENT_COUNT = 4;
const DEFAULT_MAX_ATTACHMENT_SIZE = 8 * 1024 * 1024;
const TEXT_ATTACHMENT_RE = /\.(txt|md|json|csv|pdf|doc|docx)$/i;

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
  return String(file.type || '').startsWith('image/') || TEXT_ATTACHMENT_RE.test(String(file.name || ''));
}

export async function filesToAttachments(files, currentAttachments = [], options = {}) {
  const maxCount = options.maxCount || DEFAULT_MAX_ATTACHMENT_COUNT;
  const maxSize = options.maxSize || DEFAULT_MAX_ATTACHMENT_SIZE;
  const onWarning = typeof options.onWarning === 'function' ? options.onWarning : () => {};
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
    if (!isSupportedAttachment(file)) {
      onWarning(`已忽略不支持的文件：${file.name}`);
      continue;
    }

    if (file.size > maxSize) {
      onWarning(`文件过大，已忽略：${file.name}`);
      continue;
    }

    const isImage = String(file.type || '').startsWith('image/');
    const isTextFile = !isImage;
    const attachment = {
      name: file.name,
      type: file.type,
      size: file.size,
      previewUrl: null,
      dataUrl: null,
      textContent: null,
      file,
      isTextFile,
    };

    if (isImage) {
      attachment.previewUrl = URL.createObjectURL(file);
      attachment.dataUrl = await readFileAsDataUrl(file).catch(() => '');
    } else {
      attachment.textContent = await readFileAsText(file).catch(() => '');
      if (!attachment.textContent) {
        onWarning(`无法读取文件内容：${file.name}`);
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
  const hasImageAttachment = attachments.some(item => !item?.isTextFile);

  attachments.forEach(item => {
    if (item?.isTextFile && item?.textContent) {
      content.push({ type: 'text', text: `\n\n--- 附件：${item.name} ---\n${item.textContent}\n--- 附件结束 ---\n` });
      return;
    }

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

