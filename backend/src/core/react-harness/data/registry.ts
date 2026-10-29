import type {JsonObject} from '@earendil-works/pi-ai';
import {AppError} from '../../errors.js';
import type {AgentData} from '../../agent/data/index.js';
import type {ReactHarness, ReactHarnessFactory} from '../contracts.js';
import {ResidentHarnesses} from './resident-harnesses.js';

interface Source {createReactHarnessFactories?(id:string): ReactHarnessFactory[] | Promise<ReactHarnessFactory[]>; createReactHarnesses?(id:string): ReactHarness[]}
/** React Harness residency and durable state restoration use Agent's public data model. */
export class ReactHarnessRegistry {
  private readonly resident = new ResidentHarnesses();
  constructor(private readonly store:AgentData, private readonly source:Source) {}
  clear():void{this.resident.clear();}
  invalidate(id:string):void{this.resident.invalidate(id);}
  async get(agentId: string): Promise<ReactHarness[]> {
    return this.resident.get(agentId, async () => {
      const factories = await this.source.createReactHarnessFactories?.(agentId) ?? [];
      const ids = new Set<string>();
      const harnesses: ReactHarness[] = [];

      for (const factory of factories) {
        if (!factory.harnessId || ids.has(factory.harnessId)) {
          throw new AppError('invalid_config', `Duplicate or empty React Harness id: ${factory.harnessId}`);
        }
        ids.add(factory.harnessId);

        const state = await this.store.getComponentState(agentId, factory.harnessId);
        let acknowledged = state;
        let saving = Promise.resolve();

        const persist = (revision: number, data: JsonObject) => {
          const operation = saving.then(async () => {
            try {
              const next = await this.store.saveComponentState(agentId, factory.harnessId, revision, data);
              acknowledged = next;
              // Notify resident that harness state has been persisted
              this.resident.changed(agentId, {
                baseRevision: revision,
                revision: next.revision,
                harnessId: factory.harnessId,
                data: next.data,
              });
              return structuredClone(next);
            } catch (error) {
              this.resident.invalidate(agentId);
              throw error;
            }
          });
          saving = operation.then(() => undefined);
          return operation;
        };

        const harness = factory.create(acknowledged, persist);
        if (!harness || typeof harness.handle !== 'function' || typeof harness.canHandle !== 'function') {
          throw new AppError('invalid_config', `Invalid React Harness: ${factory.harnessId}`);
        }
        harnesses.push(harness);
      }

      if (!factories.length) {
        harnesses.push(...(this.source.createReactHarnesses?.(agentId) ?? []));
      }

      return harnesses;
    });
  }

}
