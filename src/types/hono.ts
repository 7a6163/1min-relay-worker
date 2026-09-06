import type { Env } from "./index";

export type HonoEnv = {
  Bindings: Env;
  Variables: {
    apiKey: string;
  };
};
