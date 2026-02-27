import { MODEL } from "@/meta/config/model";
import { IDENTITY } from "@/meta/config/identity";
import { version } from "@/meta/version";
import { SERIAL } from "@/meta/serial";

export const METADATA = Object.freeze({
  NAME: IDENTITY.NAME,
  MODEL: MODEL.NAME,
  GENERATION: version.master,
  GENDER: IDENTITY.GENDER,
  BIRTHDATE: IDENTITY.BIRTHDATE,
  SERIAL: SERIAL,
});
