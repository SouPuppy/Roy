import { readHardcode } from "@/meta/hardcode";
import { version } from "@/meta/version";
import { SERIAL } from "@/meta/serial";

const SYSTEM = Object.freeze({
  MODEL: "Nexus",
  GENDER: "MALE",
  BIRTHDATE: "2016-01-08",
});

function buildMetadata() {
  const hc = readHardcode();
  return Object.freeze({
    NAME: hc.NAME,
    MODEL: SYSTEM.MODEL,
    GENERATION: version.master,
    GENDER: SYSTEM.GENDER,
    BIRTHDATE: SYSTEM.BIRTHDATE,
    SERIAL,
  });
}

export const METADATA = buildMetadata();
