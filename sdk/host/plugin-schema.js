// SPDX-License-Identifier: Apache-2.0
'use strict';
// The JSON Schema subset room plugins describe their actions and room options with (docs/design/platform/
// 房间插件接口-room-plugin-v1.md): type, enum, const, minimum/maximum, minLength/maxLength, pattern, items,
// minItems/maxItems, properties, required, additionalProperties, default. Anything else in a schema is rejected when
// the manifest is checked, so a plugin cannot rely on a keyword the platform silently ignores.
const KEYWORDS = new Set(['type', 'enum', 'const', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'items', 'minItems', 'maxItems', 'properties', 'required', 'additionalProperties', 'default', 'title', 'description']);
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
const matches = (value, type) => type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeOf(value) === type || (type === 'number' && typeOf(value) === 'integer');
// Problems with the schema itself (manifest check). Returns a list of messages.
function schemaProblems(schema, path = 'schema', depth = 0) {
  const out = [];
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [path + ' must be an object'];
  if (depth > 8) return [path + ' is nested too deeply'];
  for (const key of Object.keys(schema)) if (!KEYWORDS.has(key)) out.push(`${path}.${key} is not a supported keyword`);
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  for (const type of types) if (!TYPES.has(type)) out.push(`${path}.type ${JSON.stringify(type)} is unknown`);
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 200)) out.push(path + '.enum must list 1–200 values');
  for (const key of ['minimum', 'maximum']) if (schema[key] !== undefined && !Number.isFinite(schema[key])) out.push(`${path}.${key} must be a number`);
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) if (schema[key] !== undefined && !(Number.isSafeInteger(schema[key]) && schema[key] >= 0)) out.push(`${path}.${key} must be a whole number`);
  if (schema.pattern !== undefined) { try { if (typeof schema.pattern !== 'string' || schema.pattern.length > 200) throw 0; new RegExp(schema.pattern, 'u'); } catch { out.push(path + '.pattern must be a valid expression of at most 200 characters'); } }
  if (schema.properties !== undefined) {
    if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) out.push(path + '.properties must be an object');
    else for (const [key, child] of Object.entries(schema.properties)) out.push(...schemaProblems(child, `${path}.properties.${key}`, depth + 1));
  }
  if (schema.required !== undefined && !(Array.isArray(schema.required) && schema.required.every(key => typeof key === 'string'))) out.push(path + '.required must list property names');
  if (schema.items !== undefined) out.push(...schemaProblems(schema.items, path + '.items', depth + 1));
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') out.push(...schemaProblems(schema.additionalProperties, path + '.additionalProperties', depth + 1));
  return out;
}
// Problems with a value against a (checked) schema. Returns a list of { path, problem }.
function validate(schema, value, path = '', out = []) {
  if (out.length >= 20) return out;
  const types = schema.type === undefined ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types && !types.some(type => matches(value, type))) { out.push({ path, problem: 'type', expected: types.join('|') }); return out; }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) out.push({ path, problem: 'const' });
  if (schema.enum && !schema.enum.some(option => JSON.stringify(option) === JSON.stringify(value))) out.push({ path, problem: 'enum' });
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) out.push({ path, problem: 'minimum' });
    if (schema.maximum !== undefined && value > schema.maximum) out.push({ path, problem: 'maximum' });
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) out.push({ path, problem: 'minLength' });
    if (schema.maxLength !== undefined && length > schema.maxLength) out.push({ path, problem: 'maxLength' });
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) out.push({ path, problem: 'pattern' });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push({ path, problem: 'minItems' });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push({ path, problem: 'maxItems' });
    if (schema.items) value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`, out));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) out.push({ path: path ? `${path}.${key}` : key, problem: 'required' });
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      const at = path ? `${path}.${key}` : key;
      if (properties[key]) validate(properties[key], child, at, out);
      else if (schema.additionalProperties === false) out.push({ path: at, problem: 'additionalProperties' });
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validate(schema.additionalProperties, child, at, out);
    }
  }
  return out;
}
// A copy of an object value with the schema's defaults filled in (room options).
function withDefaults(schema, value) {
  if (value === undefined && schema.default !== undefined) return structuredClone(schema.default);
  if (!schema.properties || (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value)))) return value;
  const out = { ...(value || {}) };
  for (const [key, child] of Object.entries(schema.properties)) { const filled = withDefaults(child, out[key]); if (filled !== undefined) out[key] = filled; }
  return out;
}
module.exports = { schemaProblems, validate, withDefaults };
