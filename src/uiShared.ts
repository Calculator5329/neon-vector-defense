export function utilityWidgetOpen(): boolean {
  return document.body.classList.contains('ai-open') || document.body.classList.contains('fb-open');
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}
