import { Hono } from "hono";

import { handleModelsEndpoint } from "../handlers";
import { authMiddleware } from "../middleware/auth";
import type { HonoEnv } from "../types/hono";

const app = new Hono<HonoEnv>();

app.get("/", authMiddleware, (c) => handleModelsEndpoint(c.env));

export default app;
