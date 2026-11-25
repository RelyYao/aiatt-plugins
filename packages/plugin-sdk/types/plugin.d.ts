// SPDX-License-Identifier: Apache-2.0
// Types for room plugin code (room-plugin@1). Reference them from server/index.js with
//   /// <reference types="@aiatt/plugin-sdk" />
// `definePlugin` is a global inside the sandbox; the functions below are what the host calls.
declare namespace AiattPlugin {
  type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
  interface Seat { id: string; kind: 'human' | 'agent' | 'bot'; name?: string; team?: string; owner?: boolean; engine?: boolean }
  interface Rng { (): number; int(lo: number, hi: number): number; pick<T>(list: T[]): T; shuffle<T>(list: T[]): T[] }
  interface Context {
    now: number;
    seats: Seat[];
    config: Record<string, any>;
    rng: Rng;
    t(key: string, params?: Record<string, string | number>): string;
    commit(value: Json): { hash: string; salt: string };
    verify(value: Json, salt: string, hash: string): boolean;
    sha256(text: string): string;
    actor?: string;
    host?: boolean;
  }
  interface Decision { actor: string; actions: string[]; deadlineSeconds?: number; deadlineAt?: number | null; key?: string | number }
  interface Action { type: string; [field: string]: any }
  interface Refusal { error: string; message?: string; status?: 400 | 403 | 409 }
  interface Step<S> { state: S; events?: Array<{ type: string; [field: string]: any }> }
  interface Result { done: boolean; ranking?: string[][]; summary?: string; highlights?: any[] }
  interface Plugin<S = any, V = any> {
    setup?(ctx: Context): S;
    decisions(state: S, ctx: Context): Decision[];
    apply(state: S, action: Action, ctx: Context): Step<S> | Refusal;
    timeout?(state: S, decision: Decision, ctx: Context): Action;
    leave?(state: S, seat: string, ctx: Context): Step<S>;
    engine?(state: S, decision: Decision, ctx: Context): Action | null;
    secrets?(state: S): Array<{ value: Json; visibleTo: string[] }>;
    view(state: S, viewer: string | null, ctx: Context): V;
    result(state: S, ctx: Context): Result;
    migrate?(state: any, fromVersion: string): S;
  }
}
declare function definePlugin<S, V>(plugin: AiattPlugin.Plugin<S, V>): AiattPlugin.Plugin<S, V>;
declare const module: { exports: any };
