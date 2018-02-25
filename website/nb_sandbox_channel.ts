
type Handler = (...args: any[]) => Promise<any>;
type Handlers = { [name: string]: Handler };

interface Message {
  type: "syn" | "ack" | "call" | "return";
}

interface CallMessage extends Message {
  type: "call";
  id: string;
  handler: string;
  args: any[];
}

interface ReturnMessage extends Message {
  type: "return";
  id: string;
  result?: any;
  error?: any;
}

interface Resolver<T> extends Promise<T> {
  resolve: (value?: T) => void;
  reject: (value: any) => void;
}

function createResolver<T>(): Resolver<T> {
  let methods;
  const promise = new Promise((...args) => { methods = args; }) as Resolver<T>;
  [promise.resolve, promise.reject] = methods;
  return promise;
}

class Channel {
  private ready = createResolver<void>();
  private readonly unique = Math.random();
  private counter = 0;
  private returnHandlers = new Map<string, Resolver<any>>();

  constructor(private remote: Window, private handlers: Handlers) {
    window.addEventListener("message", event => this.onMessage(event));
    this.remote.postMessage({type: "syn"}, "*");
  }

  async call(handler: string, ...args: any[]): Promise<any> {
    await this.ready;

    const id = `${this.unique}_${this.counter++}`;
    const message: CallMessage = {
      type: "call",
      id,
      handler,
      args
    };

    const resolver = createResolver<any>();
    this.returnHandlers.set(id, resolver);

    try {
      this.remote.postMessage(message, "*");
      return await resolver;
    } finally {
      this.returnHandlers.delete(id);
    }
  }

  private onMessage(event: MessageEvent): void {
    const {type} = event.data;
    switch (type) {
      case "syn":
      case "ack":
        this.onHandshake(event);
        break;
      case "call":
        this.onCall(event);
        break;
      case "return":
        this.onReturn(event);
        break;
    }
  }

  private onHandshake(event: MessageEvent) {
    const {type} = event.data;
    if (type === "syn") {
      event.source.postMessage({ type: "ack" }, "*");
    }
    this.ready.resolve();
  }

  private async onCall(event: MessageEvent) {
    const {id, handler, args} = event.data;
    const ret: ReturnMessage = {
      type: "return",
      id
    };
    try {
      const result = await this.handlers[handler](...args);
      event.source.postMessage({ result, ...ret }, "*");
    } catch (error) {
      if (error instanceof Error) {
        const { message, stack } = error;
        error = Object.assign({ message, stack }, error);
      }
      event.source.postMessage({ error, ...ret }, "*");
    }
  }

  private onReturn(event: MessageEvent) {
    const message: ReturnMessage = event.data;
    const id = message.id;
    const resolver = this.returnHandlers.get(id);
    if (resolver === undefined) {
        return; // Not for us.
    }
    if (message.hasOwnProperty("error")) {
      resolver.reject(message.error);
    } else {
      resolver.resolve(message.result);
    }
  }
}
