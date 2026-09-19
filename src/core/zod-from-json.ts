import { z } from 'zod';

/**
 * A minimal JSON-Schema object description. Only the fields MemPalace uses in
 * its MCP tool schemas are typed here; an index signature keeps the type
 * permissive so we can paste the Python `TOOLS[...]["input_schema"]` verbatim.
 */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  additionalProperties?: boolean | JsonSchema;
  format?: string;
  description?: string;
  [key: string]: unknown;
}

function convertValue(schema: JsonSchema): z.ZodType {
  const t = schema.type;
  if (Array.isArray(t)) {
    const nonNull = t.find((x) => x !== 'null');
    const base = convertValue(nonNull ? { ...schema, type: nonNull } : schema);
    return t.includes('null') ? base.nullable() : base;
  }

  switch (t) {
    case 'string': {
      let out: z.ZodType =
        Array.isArray(schema.enum) && schema.enum.every((v) => typeof v === 'string')
          ? z.enum(schema.enum as [string, ...string[]])
          : z.string();
      if (typeof schema.minLength === 'number') out = (out as z.ZodString).min(schema.minLength);
      if (typeof schema.maxLength === 'number') out = (out as z.ZodString).max(schema.maxLength);
      return out;
    }
    case 'integer': {
      let out = z.number().int();
      if (typeof schema.minimum === 'number') out = out.min(schema.minimum);
      if (typeof schema.maximum === 'number') out = out.max(schema.maximum);
      return out;
    }
    case 'number': {
      let out = z.number();
      if (typeof schema.minimum === 'number') out = out.min(schema.minimum);
      if (typeof schema.maximum === 'number') out = out.max(schema.maximum);
      return out;
    }
    case 'boolean':
      return z.boolean();
    case 'array': {
      const items = schema.items as JsonSchema | undefined;
      return z.array(items ? convertValue(items) : z.any());
    }
    case 'object':
      // Cast to ZodType so nested objects fit the recursive return type.
      return convertObject(schema) as z.ZodType;
    default:
      return z.any();
  }
}

function convertObject(schema: JsonSchema): z.ZodObject<Record<string, z.ZodType>> {
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];
  const shape: Record<string, z.ZodType> = {};

  for (const [key, value] of Object.entries(properties)) {
    let field = convertValue(value ?? {});
    if (!required.includes(key)) field = field.optional();
    shape[key] = field;
  }

  // `.passthrough()` so nested objects that intentionally carry free-form keys
  // (e.g. "metadata", "diary") are not rejected by stricter validation than
  // MemPalace itself applies. The Python server whitelists/drops extras anyway.
  return z.object(shape).passthrough();
}

/**
 * Convert a JSON-Schema input description into a ZodObject. The returned object
 * exposes `.shape`, which both LM Studio's `tool()` and the MCP SDK's
 * `registerTool()` accept as their parameter/`inputSchema` raw shape.
 */
export function jsonSchemaToZod(schema: JsonSchema): z.ZodObject<Record<string, z.ZodType>> {
  if (!schema || schema.type !== 'object') {
    return z.object({}).passthrough();
  }
  return convertObject(schema);
}
