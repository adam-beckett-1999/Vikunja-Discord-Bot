![Vikunja Discord Bot Banner](/demo/vikunja-discord-bot-banner-with-background.png)

---

# Command Reference

This file lists all currently available slash commands, with a short description and usage example.

## Commands

| Slash command | Description | Example |
| --- | --- | --- |
| /project-list | List all Vikunja projects accessible to the configured API token. | /project-list |
| /task-list | List tasks across all projects, or filter to a single project and optional title search. | /task-list project:Engineering search:api |
| /task-get | Show details for a specific task. | /task-get project:Engineering task:Fix webhook retry |
| /task-create | Create a new task in a project. | /task-create project:Engineering title:Fix webhook retry due:2026-07-01 priority:3 |
| /task-update | Update an existing task title, description, due date, and or priority. | /task-update project:Engineering task:Fix webhook retry title:Improve retry strategy priority:4 |
| /task-delete | Delete a task. | /task-delete project:Engineering task:Old test task |
| /task-done | Mark a task as done. | /task-done project:Engineering task:Fix webhook retry |
| /task-pending | Mark a task as pending. | /task-pending project:Engineering task:Fix webhook retry |
| /task-labels | Add and or remove one or more labels on a task using comma-separated label names. | /task-labels project:Engineering task:Fix webhook retry add:backend,urgent remove:blocked |
| /task-assignee | List, add, and or remove assignees on a task. Add and remove accept comma-separated values such as username or id:123. | /task-assignee project:Engineering task:Fix webhook retry add:alice,id:42 remove:bob |
| /task-reminder add | Add a reminder to a task using YYYY-MM-DD HH:mm in the bot timezone. | /task-reminder add project:Engineering task:Fix webhook retry at:2026-06-21 18:00 |
| /task-reminder list | List reminders on a task. | /task-reminder list project:Engineering task:Fix webhook retry |
| /task-reminder remove | Remove a reminder from a task (reminder option supports autocomplete). | /task-reminder remove project:Engineering task:Fix webhook retry reminder:2026-06-21 18:00 |
| /webhook-register | Register a Vikunja webhook for a project, with optional event filter and channel mapping. | /webhook-register project:Engineering events:task.created,task.updated channel:#vikunja-updates |
| /webhook-channel set | Map a project to a Discord channel for webhook posts. | /webhook-channel set project:Engineering channel:#vikunja-updates |
| /webhook-channel remove | Remove a project-to-channel webhook mapping. | /webhook-channel remove project:Engineering |
| /webhook-channel list | List all project-to-channel webhook mappings. | /webhook-channel list |
| /alert-assignee link | Link a Vikunja assignee identity to a Discord user for reminder pings. | /alert-assignee link assignee:alice discord-user:@Alice |
| /alert-assignee unlink | Remove an assignee to Discord user reminder link. | /alert-assignee unlink assignee:alice |
| /alert-assignee list | List all assignee to Discord reminder links. | /alert-assignee list |

## Notes

- Project and task options use autocomplete in supported command flows.
- The /task-reminder add at value must use 24-hour format: YYYY-MM-DD HH:mm.
- The /task-labels add and remove options are comma-separated lists.
- The /task-assignee add and remove options are comma-separated lists and support mixed forms such as username and id:123.
