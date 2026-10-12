export type Route = { page: 'home' } | { page: 'workspace'; id: string } | { page: 'conversation'; id: string } | { page: 'providers' };

export const validId = /^[A-Za-z0-9_-]{1,64}$/;

/** The page an address names: `?workspace=<id>`, `?agent=<id>`, `?page=providers`, or the home page. */
export function readRoute(search: string): Route {
  const query = new URLSearchParams(search);
  const workspace = query.get('workspace');
  if (workspace && validId.test(workspace)) return { page: 'workspace', id: workspace };
  const agent = query.get('agent');
  if (agent && validId.test(agent)) return { page: 'conversation', id: agent };
  if (query.get('page') === 'providers') return { page: 'providers' };
  return { page: 'home' };
}

export function routeUrl(route: Route): string {
  if (route.page === 'workspace') return `?workspace=${encodeURIComponent(route.id)}`;
  if (route.page === 'conversation') return `?agent=${encodeURIComponent(route.id)}`;
  if (route.page === 'providers') return '?page=providers';
  return '?page=home';
}

export const sameRoute = (a: Route, b: Route) => routeUrl(a) === routeUrl(b);
