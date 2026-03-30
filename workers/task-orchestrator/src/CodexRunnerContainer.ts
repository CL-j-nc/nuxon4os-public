let ContainerBase = class {};

try {
  const module = await import('@cloudflare/containers');
  ContainerBase = module.Container;
} catch {
  // Tests do not provide the cloudflare:workers module that @cloudflare/containers expects.
}

export class CodexRunnerContainer extends ContainerBase {
  defaultPort = 8080;
  sleepAfter = '2m';
}
