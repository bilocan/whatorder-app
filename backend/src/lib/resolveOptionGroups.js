/**
 * Resolve effective optionGroups for a menu item from reusable library refs,
 * legacy inline groups, and extendsGroupIds inheritance.
 */

function mergeOptionLists(lists) {
  const byId = new Map();
  const order = [];
  for (const list of lists) {
    for (const opt of list ?? []) {
      if (byId.has(opt.id)) {
        byId.set(opt.id, opt);
      } else {
        byId.set(opt.id, opt);
        order.push(opt.id);
      }
    }
  }
  return order.map((id) => byId.get(id));
}

function expandOptionGroup(group, templatesById, visited = new Set()) {
  if (!group) return null;
  if (visited.has(group.id)) {
    return { ...group, options: [...(group.options ?? [])] };
  }
  visited.add(group.id);

  const lists = [];
  for (const extId of group.extendsGroupIds ?? []) {
    const parent = templatesById[extId];
    if (!parent) continue;
    const expanded = expandOptionGroup(parent, templatesById, new Set(visited));
    if (expanded?.options?.length) lists.push(expanded.options);
  }
  lists.push(group.options ?? []);

  return { ...group, options: mergeOptionLists(lists) };
}

function resolveMenuItemOptionGroups(item, templatesById = {}) {
  const fromRefs = (item.optionGroupIds ?? [])
    .map((id) => templatesById[id])
    .filter(Boolean)
    .map((g) => expandOptionGroup(g, templatesById))
    .filter(Boolean);

  if (fromRefs.length) return fromRefs;

  return item.optionGroups ?? [];
}

function indexOptionGroupTemplates(docs) {
  const map = {};
  for (const doc of docs) {
    const data = typeof doc.data === 'function' ? doc.data() : doc;
    const id = doc.id ?? data.id;
    if (!id) continue;
    map[id] = { ...data, id };
  }
  return map;
}

/** Groups that declare extendsGroupIds including targetId. */
function indexGroupsExtendingTarget(templatesById = {}) {
  const map = {};
  for (const g of Object.values(templatesById)) {
    for (const extId of g.extendsGroupIds ?? []) {
      if (!map[extId]) map[extId] = [];
      map[extId].push(g);
    }
  }
  for (const list of Object.values(map)) {
    list.sort((a, b) => a.label.localeCompare(b.label));
  }
  return map;
}

function wouldCreateExtendsCycle(groupId, extendsGroupIds, templatesById) {
  if (!groupId || !extendsGroupIds?.length) return false;
  if (extendsGroupIds.includes(groupId)) return true;

  const stack = [...extendsGroupIds];
  const seen = new Set();

  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (id === groupId) return true;
    const g = templatesById[id];
    if (g?.extendsGroupIds?.length) stack.push(...g.extendsGroupIds);
  }
  return false;
}

module.exports = {
  mergeOptionLists,
  expandOptionGroup,
  resolveMenuItemOptionGroups,
  indexOptionGroupTemplates,
  indexGroupsExtendingTarget,
  wouldCreateExtendsCycle,
};
