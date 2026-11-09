import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const openSession = defineRpc({
  name: "pet.open-session",
  input: z.object({
    clientId: z.string().uuid(),
    href: z.string().max(2000),
    standalone: z.boolean(),
    appliedRequestId: z.string().uuid().nullable(),
  }),
  output: z.object({ request: z.object({ id: z.string().uuid(), url: z.string() }).nullable() }),
});
