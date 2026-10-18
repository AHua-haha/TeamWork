/** Purpose roots determine raw-file editability; nested topic names do not change it. */
export function writableContextPath(path:string):boolean {
  const key=path.toLowerCase();
  return key==='design'||key.startsWith('design/');
}
