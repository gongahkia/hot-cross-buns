import { runHcbCli } from "../src/cli/hcb";

void runHcbCli().then((exitCode) => {
  process.exitCode = exitCode;
});
