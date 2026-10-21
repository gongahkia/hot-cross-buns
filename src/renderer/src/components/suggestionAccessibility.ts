import { useLayoutEffect, useRef } from "react";

export function isComposingKey(event: { isComposing?: boolean; keyCode?: number; nativeEvent?: { isComposing?: boolean; keyCode?: number } }): boolean {
  return Boolean(event.isComposing || event.keyCode === 229 || event.nativeEvent?.isComposing || event.nativeEvent?.keyCode === 229);
}

export function useSuggestionAccessibility(getInput: () => HTMLElement | null, listboxId: string, optionId: string | null, visible: boolean, revision = ""): void {
  const input = useRef(getInput); input.current = getInput;
  useLayoutEffect(() => {
    if (!visible) return;
    const element = input.current();
    if (!element) return;
    element.setAttribute("aria-controls", listboxId);
    element.setAttribute("aria-expanded", "true");
    element.setAttribute("aria-autocomplete", "list");
    element.setAttribute("aria-haspopup", "listbox");
    if (optionId) {
      element.setAttribute("aria-activedescendant", optionId);
      document.getElementById(optionId)?.scrollIntoView?.({ block: "nearest" });
    } else element.removeAttribute("aria-activedescendant");
    return () => {
      if (element.getAttribute("aria-controls") !== listboxId) return;
      for (const attribute of ["aria-controls", "aria-expanded", "aria-autocomplete", "aria-haspopup", "aria-activedescendant"]) element.removeAttribute(attribute);
    };
  }, [listboxId, optionId, visible, revision]);
}
