// Shared collapse timer — accessible by both Sidebar and App
// so the header can cancel the sidebar's pending collapse.

let timer: ReturnType<typeof setTimeout> | null = null;

export function cancelSidebarCollapse() {
  if (timer) { clearTimeout(timer); timer = null; }
}

export function scheduleSidebarCollapse(onCollapse: () => void, delay = 400) {
  cancelSidebarCollapse();
  timer = setTimeout(() => { onCollapse(); timer = null; }, delay);
}