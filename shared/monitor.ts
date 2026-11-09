import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const monitor = defineRpc({
  name: "pet.monitor",
  input: z.object({}),
  output: z.object({ connected: z.boolean() }),
});
