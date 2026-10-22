import { INPUT_BYTES } from "./api.js";
import type { InputCommand } from "./api.js";
import { dqAxis, dqYaw, qAxis, qYaw } from "./quant.js";

const u32 = (v: number): number => (Number.isFinite(v) ? Math.trunc(v) >>> 0 : 0);

/** Snap a command onto the wire grid. The sim applies this to every input it consumes. */
export function quantizeInput(cmd: InputCommand): InputCommand {
  return {
    seq: u32(cmd.seq),
    tick: u32(cmd.tick),
    moveX: dqAxis(qAxis(cmd.moveX)),
    moveZ: dqAxis(qAxis(cmd.moveZ)),
    yaw: Number.isFinite(cmd.yaw) ? dqYaw(qYaw(cmd.yaw)) : 0,
    buttons: u32(cmd.buttons) & 0xffff,
  };
}

/**
 * 15 bytes, little endian: seq u32, tick u32, moveX i8, moveZ i8, yaw u16,
 * buttons u16, reserved u8 (0).
 */
export function encodeInput(cmd: InputCommand, out?: Uint8Array, offset = 0): Uint8Array {
  const buf = out ?? new Uint8Array(INPUT_BYTES);
  if (offset < 0 || offset + INPUT_BYTES > buf.length) throw new RangeError("engine-sim: input buffer too small");
  const dv = new DataView(buf.buffer, buf.byteOffset + offset, INPUT_BYTES);
  dv.setUint32(0, u32(cmd.seq), true);
  dv.setUint32(4, u32(cmd.tick), true);
  dv.setInt8(8, qAxis(cmd.moveX));
  dv.setInt8(9, qAxis(cmd.moveZ));
  dv.setUint16(10, Number.isFinite(cmd.yaw) ? qYaw(cmd.yaw) : 0, true);
  dv.setUint16(12, u32(cmd.buttons) & 0xffff, true);
  dv.setUint8(14, 0);
  return buf;
}

export function decodeInput(bytes: Uint8Array, offset = 0): InputCommand {
  if (offset < 0 || offset + INPUT_BYTES > bytes.length) throw new RangeError("engine-sim: truncated input command");
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, INPUT_BYTES);
  return {
    seq: dv.getUint32(0, true),
    tick: dv.getUint32(4, true),
    moveX: dqAxis(dv.getInt8(8)),
    moveZ: dqAxis(dv.getInt8(9)),
    yaw: dqYaw(dv.getUint16(10, true)),
    buttons: dv.getUint16(12, true),
  };
}

/** Count byte (u8, max 255) followed by that many 15-byte commands. */
export function encodeInputs(cmds: readonly InputCommand[]): Uint8Array {
  if (cmds.length > 255) throw new RangeError("engine-sim: at most 255 commands per batch");
  const out = new Uint8Array(1 + cmds.length * INPUT_BYTES);
  out[0] = cmds.length;
  cmds.forEach((c, i) => encodeInput(c, out, 1 + i * INPUT_BYTES));
  return out;
}

export function decodeInputs(bytes: Uint8Array): InputCommand[] {
  const n = bytes[0];
  if (n === undefined) throw new RangeError("engine-sim: empty input batch");
  if (bytes.length < 1 + n * INPUT_BYTES) throw new RangeError("engine-sim: truncated input batch");
  const out: InputCommand[] = [];
  for (let i = 0; i < n; i++) out.push(decodeInput(bytes, 1 + i * INPUT_BYTES));
  return out;
}
