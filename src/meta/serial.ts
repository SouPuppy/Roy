import { IDENTITY } from "@/meta/config/identity";
import { GENERATION, BUILD } from "@/meta/version";

const genderCode =
  /male/i.test(IDENTITY.GENDER) ? "M" : /female/i.test(IDENTITY.GENDER) ? "F" : "X";

export const SERIAL =
  IDENTITY.NAME[0] +
  GENERATION +
  BUILD +
  genderCode +
  "00000";
