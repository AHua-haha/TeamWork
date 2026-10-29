export class OperationQueue {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, action: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
    this.tails.set(key,result);
    void result.finally(() => { if(this.tails.get(key) === result)this.tails.delete(key); }).catch(() => {});
    return result;
  }
}
