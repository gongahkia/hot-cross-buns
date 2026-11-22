package main

import (
	"errors"
	"fmt"
	"io"
)

const agentFamilyUsage = `usage:
  hot-cross-buns agent list
  hot-cross-buns agent cli list|enable|disable|doctor ...

short form:
  hot-cross-buns -a ...`

func configCommand(arguments []string, out io.Writer) error {
	if len(arguments) > 0 && arguments[0] == "hook" {
		return hookCommand(arguments[1:], out)
	}
	return configure(arguments, out)
}

func agentFamilyCommand(arguments []string, out io.Writer) error {
	if len(arguments) == 0 {
		return errors.New(agentFamilyUsage)
	}
	if isHelpArgument(arguments[0]) {
		_, err := fmt.Fprintln(out, agentFamilyUsage)
		return err
	}
	switch arguments[0] {
	case "acp":
		return errors.New("ACP Code mode is retired; use Hot Cross Buns conversations or work-rpc for automation")
	case "list", "cli":
		return agentCommand(arguments, out)
	default:
		return errors.New(agentFamilyUsage)
	}
}

func workCommand(arguments []string, out io.Writer) error {
	if len(arguments) == 0 {
		return workTask(arguments, out)
	}
	if isHelpArgument(arguments[0]) {
		_, err := fmt.Fprintln(out, usage)
		return err
	}
	switch arguments[0] {
	case "inspect":
		return inspectTask(arguments[1:], out)
	case "code":
		return errors.New("direct Code mode is retired; describe the outcome in a Hot Cross Buns conversation")
	case "resume":
		return workResumeCommand(arguments[1:], out)
	case "eval":
		return workEvalCommand(arguments[1:], out)
	case "review":
		return reviewCommand(arguments[1:], out)
	case "export":
		return exportPatch(arguments[1:], out)
	case "apply":
		return applyPatch(arguments[1:], out)
	case "retry":
		return retryWorkDelivery(arguments[1:], out)
	case "feedback":
		return workFeedbackCommand(arguments[1:], out)
	case "snapshot":
		return snapshotCommand(arguments[1:], out)
	default:
		return workTask(arguments, out)
	}
}

func workResumeCommand(arguments []string, out io.Writer) error {
	if len(arguments) == 0 {
		return unifiedResume(arguments, out)
	}
	if arguments[0] == "--refresh-source" || arguments[0] == "--parent" {
		return workTask(append([]string{"resume"}, arguments...), out)
	}
	return unifiedResume(arguments, out)
}

func movedCommand(command string) error {
	canonical := map[string]string{
		"hook":      "hot-cross-buns config hook",
		"connector": "hot-cross-buns provider connector",
		"inbox":     "hot-cross-buns job inbox",
		"snapshot":  "hot-cross-buns work snapshot",
		"inspect":   "hot-cross-buns work inspect",
		"resume":    "hot-cross-buns work resume",
		"eval":      "hot-cross-buns work eval",
		"review":    "hot-cross-buns work review",
		"export":    "hot-cross-buns work export",
		"apply":     "hot-cross-buns work apply",
	}
	return fmt.Errorf("hot-cross-buns %s has moved; use '%s'", command, canonical[command])
}
