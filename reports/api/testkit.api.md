# testkit public API

```ts
import { AdapterPlugin, PluginClass, PluginDefinition, SourcePlugin, VoicePlugin } from "@distube/plugin-sdk";
//#region src/index.d.ts
declare class DeterministicClock {
  #private;
  now(): number;
  advance(milliseconds: number): void;
}
declare class DeterministicScheduler {
  #private;
  queue(task: () => void | PromiseLike<void>): void;
  flush(): Promise<void>;
}
declare class TestResource {
  readonly name: string;
  disposeCount: number;
  shouldThrow: boolean;
  constructor(name?: string);
  dispose(): void;
}
declare function describeAdapterPlugin<Instance extends AdapterPlugin>(pluginClass: PluginClass<Instance>, createDefinition: () => PluginDefinition<Instance, "adapter">): void;
declare function describeSourcePlugin<Instance extends SourcePlugin>(pluginClass: PluginClass<Instance>, createDefinition: () => PluginDefinition<Instance, "source">, acceptedInput?: unknown): void;
declare function describeVoicePlugin<Instance extends VoicePlugin>(pluginClass: PluginClass<Instance>, createDefinition: () => PluginDefinition<Instance, "voice">): void;
declare function intentionallyBroken<T>(factory: () => T): () => T;
//#endregion
export { DeterministicClock, DeterministicScheduler, TestResource, describeAdapterPlugin, describeSourcePlugin, describeVoicePlugin, intentionallyBroken };
//# sourceMappingURL=index.d.mts.map
```
