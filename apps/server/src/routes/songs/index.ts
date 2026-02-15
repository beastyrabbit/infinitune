import { Hono } from "hono";
import createRoutes from "./create";
import engagementRoutes from "./engagement";
import lifecycleRoutes from "./lifecycle";
import metadataRoutes from "./metadata";
import queryRoutes from "./queries";

const app = new Hono();

app.route("/", queryRoutes);
app.route("/", createRoutes);
app.route("/", lifecycleRoutes);
app.route("/", metadataRoutes);
app.route("/", engagementRoutes);

export default app;
