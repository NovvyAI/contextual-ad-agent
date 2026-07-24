import db from "@/utils/db";
import oss from "@/utils/oss";
import { v4 as uuid } from "uuid";
import error from "@/utils/error";
import getPath from "@/utils/getPath";
import vm from "@/utils/vm";
import task from "@/utils/taskRecord";
import Ai from "@/utils/ai";
import replaceUrl from "@/utils/replaceUrl";
import writeVersion from "@/utils/writeVersion";
import * as vendor from "@/utils/vendor";

export default {
  db,
  oss,
  uuid,
  error,
  vm,
  getPath,
  Ai,
  task,
  replaceUrl,
  writeVersion,
  vendor,
};
