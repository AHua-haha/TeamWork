import {AppError} from '../errors.js';
import {contextPath} from './data/paths.js';
import {projectDesignReference,projectNode} from './project-context.js';
export const managedRoot='.rsi';
export const memberRoot=`${managedRoot}/members`;

/** New design references, plus explicit old member-assignment aliases (not old file-layout support). */
export function nodeReference(value:string):string{
  if(projectDesignReference(value)){const path=contextPath(value);projectNode(path);return path;}
  const path=contextPath(value);
  if(!/(?:^|\/)metadata\.json$/i.test(path))throw new AppError('invalid_path','A design reference names _ctx/DESIGN.md or <file-name>.ctx/DESIGN.md');
  return path;
}
