import { readHardcode } from "@/meta/hardcode";
import { GENERATION, BUILD } from "@/meta/version";

const MODEL = "Nexus";
const GENDER = "MALE";
const genderCode = /male/i.test(GENDER) ? "M" : /female/i.test(GENDER) ? "F" : "X";

function getSerialSuffix(): string {
  const hc = readHardcode();
  return /^\d{5}$/.test(hc.SERIAL_SUFFIX) ? hc.SERIAL_SUFFIX : "00000";
}

export const SERIAL = MODEL[0] + GENERATION + BUILD + genderCode + getSerialSuffix();
