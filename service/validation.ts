import { HttpError } from "./auth.ts";

export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "invalid_object");
  return value as Record<string, any>;
}

export function keys(value: Record<string, any>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new HttpError(400, "unknown_field");
}

export function text(value: unknown, max = 128) {
  if (typeof value !== "string" || !value.length || value.length > max || /[\x00-\x1f]/.test(value))
    throw new HttpError(400, "invalid_string");
  return value;
}

export function operationBody(value: unknown) {
  const body = object(value);
  keys(body, ["action", "parameters", "policy", "client_id"]);
  const action = text(body.action);
  const fields: Record<string, string[]> = {
    "connection.connect": [],
    "connection.disconnect": [],
    "activity.stop": [],
    "sound.play": ["sound_id"],
    "lights.apply": ["preset_id", "settings"],
    "protocol.run": ["protocol_id", "recipe"],
    "animation.play": ["animation_id"],
  };
  if (!Object.hasOwn(fields, action)) throw new HttpError(422, "unsupported_action");
  const parameters = object(body.parameters ?? {});
  const policy = object(body.policy ?? {});
  keys(parameters, fields[action]);
  if (["sound.play", "protocol.run", "animation.play"].includes(action))
    text(parameters[fields[action][0]]);
  if (action === "lights.apply" && Number("preset_id" in parameters) + Number("settings" in parameters) !== 1)
    throw new HttpError(400, "choose_light_settings_or_preset");
  if (parameters.preset_id) text(parameters.preset_id);
  if (parameters.settings) object(parameters.settings);
  if ("recipe" in parameters) object(parameters.recipe);
  keys(policy, ["if_unavailable", "if_busy", "expires_in_ms", "cooldown_key", "cooldown_ms"]);
  const normalized: Record<string, any> = {
    if_unavailable: "skip",
    if_busy: "skip",
    expires_in_ms: 5000,
    cooldown_ms: 0,
    ...policy,
  };
  if (!["skip", "error", "connect"].includes(normalized.if_unavailable) ||
      !["skip", "error", "replace"].includes(normalized.if_busy))
    throw new HttpError(400, "invalid_policy");
  for (const [key, min, max] of [["expires_in_ms", 100, 30000], ["cooldown_ms", 0, 3600000]] as const) {
    if (!Number.isInteger(normalized[key]) || normalized[key] < min || normalized[key] > max)
      throw new HttpError(400, "invalid_policy");
  }
  if (normalized.cooldown_ms) text(normalized.cooldown_key);
  if (body.client_id !== undefined) text(body.client_id);
  return { action, parameters, policy: normalized, ...(body.client_id ? { client_id: body.client_id } : {}) };
}
