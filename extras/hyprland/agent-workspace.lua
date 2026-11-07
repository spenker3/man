-- Agent workspace: windows that coding agents open land on a virtual
-- monitor instead of your screen, so their test apps never cover your work or
-- take focus.
--
-- - AGENT is a headless output placed far above the real screens, with no shared
--   edge, so the cursor can't wander onto it. Hyprland still renders it, so an
--   agent can screenshot it with `grim -o AGENT`.
-- - The agent runs with AGENT_WORKSPACE=1 in its environment (for Claude Code,
--   the `env` block in ~/.claude/settings.json; for other agents, start them with
--   it set) and every process it starts inherits it. When a
--   window opens, the handler below reads that process's environment, tags the
--   window `agent`, and moves it to the `agent` workspace on AGENT without
--   focusing it. Your own terminals don't have the variable.
-- - SUPER + ALT + A brings the agent workspace onto the focused screen to watch
--   it; press again to send it back.
-- - An agent opening something for you to see runs it with AGENT_WORKSPACE=0.

local OUTPUT = "AGENT"
local WORKSPACE = "name:agent"
local TAG = "agent"

hl.monitor({ output = OUTPUT, mode = "1920x1080@60", position = "0x-20000", scale = 1 })
hl.workspace_rule({ workspace = WORKSPACE, monitor = OUTPUT, default = true, persistent = true })

-- Headless outputs only exist at runtime, so create it at login. A config
-- reload keeps the output that's already there.
hl.on("hyprland.start", function()
  hl.exec_cmd("hyprctl output create headless " .. OUTPUT)
end)

-- grim captures what AGENT displays, so keep the agent workspace on show there
-- (Omarchy also gives every monitor a numbered workspace).
local function show_agent()
  local monitor = hl.get_monitor(OUTPUT)
  if monitor then
    -- set_workspace takes the bare name; "name:agent" is silently ignored.
    monitor:set_workspace({ workspace = "agent" })
  end
end

hl.on("monitor.added", function(monitor)
  if monitor and monitor.name == OUTPUT then
    show_agent()
  end
end)

local function from_agent(pid)
  if not pid or pid <= 0 then
    return false
  end
  local file = io.open("/proc/" .. pid .. "/environ", "rb")
  if not file then
    return false
  end
  local env = "\0" .. (file:read("*a") or "")
  file:close()
  return env:find("\0AGENT_WORKSPACE=1\0", 1, true) ~= nil
end

-- open_early runs before the window is mapped, so it never shows on your screen.
-- A window rule matching the tag doesn't work here: rule effects like workspace
-- and no_initial_focus are resolved before this handler adds the tag.
hl.on("window.open_early", function(window)
  if window and from_agent(window.pid) then
    hl.dispatch(hl.dsp.window.tag({ tag = "+" .. TAG, window = window }))
    hl.dispatch(hl.dsp.window.set_prop({ prop = "no_initial_focus", value = "1", window = window }))
    hl.dispatch(hl.dsp.window.set_prop({ prop = "focus_on_activate", value = "0", window = window }))
    hl.dispatch(hl.dsp.window.move({ workspace = WORKSPACE, follow = false, window = window }))
  end
end)

-- Watch the agents: show the agent workspace here, or send it back to AGENT.
local function toggle_agent_view()
  local agent = hl.get_workspace(WORKSPACE)
  local here = hl.get_active_monitor()
  if not here then
    return
  end
  if agent and agent.monitor and agent.monitor.name == here.name then
    hl.dispatch(hl.dsp.workspace.move({ workspace = WORKSPACE, monitor = OUTPUT }))
    show_agent()
  else
    hl.dispatch(hl.dsp.workspace.move({ workspace = WORKSPACE, monitor = here.name }))
    hl.dispatch(hl.dsp.focus({ workspace = WORKSPACE }))
  end
end

o.bind("SUPER + ALT + A", "Toggle agent workspace", toggle_agent_view)
