// SPDX-License-Identifier: Apache-2.0
// Action forms from a plugin's JSON Schemas (the subset in lib/plugins/plugin-schema.js: type enum const minimum maximum
// minLength maxLength pattern items minItems maxItems properties required additionalProperties default). Pure functions:
// no DOM, so the default UI and its tests share them.
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
const matches = (value, type) => type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeOf(value) === type;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const primitive = value => value === null || ['string', 'number', 'boolean'].includes(typeof value);
export const MAX_CHIPS = 40;

// The problems of a value against a schema: a list of { path, problem } (the same shape the host reports).
export function validate(schema, value, path = '', out = []) {
  if (!isObject(schema) || out.length >= 20) return out;
  const types = schema.type === undefined ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types && !types.some(type => matches(value, type))) { out.push({ path, problem: 'type', expected: types.join('|') }); return out; }
  if (schema.const !== undefined && !same(schema.const, value)) out.push({ path, problem: 'const' });
  if (Array.isArray(schema.enum) && !schema.enum.some(option => same(option, value))) out.push({ path, problem: 'enum' });
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) out.push({ path, problem: 'minimum' });
    if (schema.maximum !== undefined && value > schema.maximum) out.push({ path, problem: 'maximum' });
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) out.push({ path, problem: 'minLength' });
    if (schema.maxLength !== undefined && length > schema.maxLength) out.push({ path, problem: 'maxLength' });
    if (schema.pattern !== undefined) { let ok = true; try { ok = new RegExp(schema.pattern, 'u').test(value); } catch { ok = true; } if (!ok) out.push({ path, problem: 'pattern' }); }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push({ path, problem: 'minItems' });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push({ path, problem: 'maxItems' });
    if (schema.items) value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`, out));
  }
  if (isObject(value)) {
    for (const key of schema.required || []) if (!own(value, key)) out.push({ path: path ? `${path}.${key}` : key, problem: 'required' });
    const properties = isObject(schema.properties) ? schema.properties : {};
    for (const [key, child] of Object.entries(value)) {
      const at = path ? `${path}.${key}` : key;
      if (own(properties, key)) validate(properties[key], child, at, out);
      else if (schema.additionalProperties === false) out.push({ path: at, problem: 'additionalProperties' });
      else if (isObject(schema.additionalProperties)) validate(schema.additionalProperties, child, at, out);
    }
  }
  return out;
}

// "move_piece" -> "Move piece". Only the label of a control; the plugin's own title wins when the schema has one.
export function humanize(name) {
  const text = String(name ?? '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, (all, a, b) => a + ' ' + b.toLowerCase()).trim();
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}
const mainType = schema => { const types = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type]; return types.find(type => type !== 'null') || null; };

// What kind of control a property needs: const (fixed, no control), enum (chips), int (stepper), number, bool, text, json.
export function kindOf(schema) {
  if (!isObject(schema)) return 'json';
  if (schema.const !== undefined) return 'const';
  const type = mainType(schema);
  if (Array.isArray(schema.enum) && schema.enum.length && schema.enum.length <= MAX_CHIPS && schema.enum.every(primitive)) return 'enum';
  if (type === 'integer') return 'int';
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'bool';
  if (type === 'string') return 'text';
  if (type === null && Array.isArray(schema.enum)) return 'json';
  return 'json';
}

// The controls of one action: [{ key, schema, kind, required, label, hint }]. An action without properties has none (a
// plain button). `type` is the platform's field and never a control.
export function fieldsOf(schema) {
  if (!isObject(schema) || !isObject(schema.properties)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(schema.properties).filter(([key]) => key !== 'type').map(([key, child]) => ({
    key, schema: isObject(child) ? child : {}, kind: kindOf(child), required: required.has(key),
    label: typeof child?.title === 'string' && child.title ? child.title : humanize(key), hint: typeof child?.description === 'string' ? child.description : '',
  }));
}

// A grid tap fills a pair of integer fields: (x,y), (row,col), (r,c) or (row,column). x is the column, y the row.
const PAIRS = [['y', 'x'], ['row', 'col'], ['r', 'c'], ['row', 'column']];
export function gridPairOf(schema) {
  if (!isObject(schema) || !isObject(schema.properties)) return null;
  const integer = key => isObject(schema.properties[key]) && mainType(schema.properties[key]) === 'integer' && schema.properties[key].const === undefined && !Array.isArray(schema.properties[key].enum);
  for (const [rowKey, colKey] of PAIRS) {
    if (!integer(rowKey) || !integer(colKey)) continue;
    const base = key => Number.isFinite(schema.properties[key].minimum) ? schema.properties[key].minimum : 0;
    return { rowKey, colKey, rowBase: base(rowKey), colBase: base(colKey) };
  }
  return null;
}

const clamp = (value, schema) => {
  let v = value;
  if (Number.isFinite(schema.minimum)) v = Math.max(schema.minimum, v);
  if (Number.isFinite(schema.maximum)) v = Math.min(schema.maximum, v);
  return v;
};
// The value a control starts with, as the text kept in the draft; undefined means "not set" (an optional field is then left out).
export function initialRaw(field) {
  const { schema, kind, required } = field;
  if (schema.default !== undefined) {
    if (kind === 'enum') { const i = schema.enum.findIndex(option => same(option, schema.default)); return i < 0 ? undefined : String(i); }
    if (kind === 'json') return JSON.stringify(schema.default);
    if (kind === 'bool') return String(schema.default === true);
    return String(schema.default);
  }
  if (kind === 'int' || kind === 'number') return required ? String(clamp(0, schema)) : undefined;
  if (kind === 'bool') return required ? 'false' : undefined;
  if (kind === 'enum') return required && schema.enum.length === 1 ? '0' : undefined;
  if (kind === 'text') return required ? '' : undefined;
  return undefined;
}
// Turns the drafts into the action body, or says what is wrong. read(field) gives the draft text (or undefined).
// fixed: values the grid tap fills ({ key: number }). Returns { body } or { error: { key, problem, field } }.
export function bodyOf(name, schema, read, fixed = {}) {
  const body = { type: name };
  for (const field of fieldsOf(schema)) {
    const { key, kind, required } = field;
    if (kind === 'const') { body[key] = field.schema.const; continue; }
    if (own(fixed, key)) { body[key] = fixed[key]; continue; }
    const raw = read(field);
    if (raw === undefined || raw === null || (raw === '' && kind !== 'text')) { if (required) return { error: { key, problem: 'required', field } }; continue; }
    let value;
    if (kind === 'enum') value = field.schema.enum[Number(raw)];
    else if (kind === 'int' || kind === 'number') { value = Number(raw); if (!Number.isFinite(value) || (kind === 'int' && !Number.isInteger(value))) return { error: { key, problem: 'type', field } }; }
    else if (kind === 'bool') value = raw === 'true';
    else if (kind === 'text') { if (raw === '' && !required) continue; value = raw; }
    else { try { value = JSON.parse(raw); } catch { return { error: { key, problem: 'json', field } }; } }
    body[key] = value;
  }
  const { type, ...rest } = body;
  const problems = validate(schema, rest);
  if (problems.length) { const first = problems[0], key = first.path.split(/[.[]/)[0] || '', field = fieldsOf(schema).find(item => item.key === key) || null; return { error: { key, problem: first.problem, field } }; }
  return { body };
}
export const clampTo = clamp;
