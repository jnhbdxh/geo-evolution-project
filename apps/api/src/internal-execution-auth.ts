import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { DomainError } from "./errors.js";

const tokenHeader = { alg: "HS256", typ: "JWT" } as const;
const tokenIssuer = "geo-os-control-plane";
const tokenAudience = "geo-os-core-internal";
const tokenSubject = "query-engine";
const maximumTokenLifetimeSeconds = 900;

const claimsSchema = z.strictObject({
  iss: z.literal(tokenIssuer),
  aud: z.literal(tokenAudience),
  sub: z.literal(tokenSubject),
  tenant_id: z.uuid(),
  execution_run_id: z.uuid(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  jti: z.uuid(),
});

export interface InternalExecutionPrincipal {
  readonly service: "QUERY_ENGINE";
  readonly tenantId: string;
  readonly executionRunId: string;
  readonly tokenId: string;
}

export class InternalExecutionAuth {
  public constructor(
    private readonly secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("INTERNAL_SERVICE_TOKEN_SECRET must contain at least 32 bytes");
    }
  }

  public issue(input: {
    readonly tenantId: string;
    readonly executionRunId: string;
    readonly lifetimeSeconds?: number;
  }): string {
    const lifetimeSeconds = input.lifetimeSeconds ?? 600;
    if (lifetimeSeconds < 1 || lifetimeSeconds > maximumTokenLifetimeSeconds) {
      throw new Error(
        `Internal execution token lifetime must be between 1 and ${maximumTokenLifetimeSeconds} seconds`,
      );
    }
    const issuedAt = Math.floor(this.now().getTime() / 1_000);
    return this.sign({
      iss: tokenIssuer,
      aud: tokenAudience,
      sub: tokenSubject,
      tenant_id: input.tenantId,
      execution_run_id: input.executionRunId,
      iat: issuedAt,
      exp: issuedAt + lifetimeSeconds,
      jti: randomUUID(),
    });
  }

  public verify(token: string): InternalExecutionPrincipal {
    try {
      const segments = token.split(".");
      if (segments.length !== 3) throw new Error("Malformed token");
      const [encodedHeader, encodedPayload, encodedSignature] = segments;
      if (!encodedHeader || !encodedPayload || !encodedSignature)
        throw new Error("Malformed token");
      const header = z
        .strictObject({ alg: z.literal(tokenHeader.alg), typ: z.literal(tokenHeader.typ) })
        .parse(JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")));
      void header;
      const expectedSignature = this.signature(`${encodedHeader}.${encodedPayload}`);
      const suppliedSignature = Buffer.from(encodedSignature, "base64url");
      if (
        expectedSignature.length !== suppliedSignature.length ||
        !timingSafeEqual(expectedSignature, suppliedSignature)
      ) {
        throw new Error("Invalid signature");
      }
      const claims = claimsSchema.parse(
        JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
      );
      const nowSeconds = Math.floor(this.now().getTime() / 1_000);
      if (claims.iat > nowSeconds + 30 || claims.exp <= nowSeconds)
        throw new Error("Expired token");
      if (claims.exp - claims.iat > maximumTokenLifetimeSeconds)
        throw new Error("Excessive lifetime");
      return {
        service: "QUERY_ENGINE",
        tenantId: claims.tenant_id,
        executionRunId: claims.execution_run_id,
        tokenId: claims.jti,
      };
    } catch {
      throw new DomainError(
        "INTERNAL_UNAUTHENTICATED",
        "A valid execution-scoped internal token is required",
        401,
      );
    }
  }

  private sign(claims: z.infer<typeof claimsSchema>): string {
    const encodedHeader = Buffer.from(JSON.stringify(tokenHeader)).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const content = `${encodedHeader}.${encodedPayload}`;
    return `${content}.${this.signature(content).toString("base64url")}`;
  }

  private signature(content: string): Buffer {
    return createHmac("sha256", this.secret).update(content, "utf8").digest();
  }
}
