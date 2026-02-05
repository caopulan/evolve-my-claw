export type ToolFilter = {
  name: string;
  action?: string;
};

export function parseToolFilter(raw: string): ToolFilter | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const [name, action] = trimmed.split("/", 2);
  if (!name) {
    return null;
  }
  return {
    name,
    action: action?.trim() || undefined,
  };
}

export function compileToolFilters(filters: string[]): ToolFilter[] {
  const out: ToolFilter[] = [];
  for (const filter of filters) {
    const parsed = parseToolFilter(filter);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

export function matchesToolFilter(
  filter: ToolFilter,
  toolName: string,
  args: Record<string, unknown> | undefined,
): boolean {
  if (filter.name !== toolName) {
    return false;
  }
  if (!filter.action) {
    return true;
  }
  const action = typeof args?.action === "string" ? args.action.trim() : "";
  return action === filter.action;
}

export function shouldExcludeTool(
  toolName: string,
  args: Record<string, unknown> | undefined,
  filters: ToolFilter[],
): boolean {
  for (const filter of filters) {
    if (matchesToolFilter(filter, toolName, args)) {
      return true;
    }
  }
  return false;
}
