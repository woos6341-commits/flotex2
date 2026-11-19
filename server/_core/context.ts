import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { TRPCError } from "@trpc/server";
import { authenticationUnavailable, isInvalidAuthentication } from "./auth-errors";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
    if (user?.status === "deleted") user = null;
  } catch (error) {
    // Only genuinely missing/invalid/revoked credentials are a public guest.
    // A DB/network outage must remain an error so clients retain the last verified user.
    if (!isInvalidAuthentication(error)) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: authenticationUnavailable().message });
    }
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
