export const INTERACTIVE_DESCENDANT_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[data-no-tile-activate="true"]',
].join(', ');

export const findInteractiveElement = (element) => {
  if (!element || typeof element.closest !== 'function') return null;
  return element.closest(INTERACTIVE_DESCENDANT_SELECTOR);
};

export const isInteractiveElement = (element) => Boolean(findInteractiveElement(element));

export const shouldIgnoreTileActivation = (target, container) => {
  const interactive = findInteractiveElement(target);
  if (!interactive) return false;
  if (!container) return true;
  return interactive !== container && typeof container.contains === 'function' && container.contains(interactive);
};
