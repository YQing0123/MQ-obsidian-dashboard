import type { ProjectInfo } from './taskParser';

/** Keep all project selectors aligned with the manual order from the project sidebar. */
export function sortProjectsByOrder(projects: readonly ProjectInfo[], order: readonly string[] | undefined): ProjectInfo[] {
  if (!order?.length) return [...projects];
  const positions = new Map(order.map((name, index) => [name, index]));
  return [...projects].sort((left, right) => {
    const leftPosition = positions.get(left.name) ?? Number.MAX_SAFE_INTEGER;
    const rightPosition = positions.get(right.name) ?? Number.MAX_SAFE_INTEGER;
    return leftPosition - rightPosition || left.name.localeCompare(right.name, 'zh-CN');
  });
}
