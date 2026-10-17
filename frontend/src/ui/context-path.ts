/** Match the first content boundary; nested topic folders do not change ownership. */
export function writableContextPath(path:string):boolean {
  for(const segment of path.toLowerCase().split('/')){
    if(segment==='design'||segment==='design.md'||segment==='metadata.json')return true;
    if(segment==='impl'||segment==='impl.md')return false;
  }
  return true;
}
