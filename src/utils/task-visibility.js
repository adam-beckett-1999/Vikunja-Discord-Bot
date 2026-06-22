const YES_NO_CHOICES = [
  { name: 'Yes', value: 'yes' },
  { name: 'No', value: 'no' },
];

export function addShowCompletedOption(builder, description = 'Include completed tasks in the results (Yes/No, default: Yes)') {
  return builder.addStringOption((opt) =>
    opt.setName('show-completed')
      .setDescription(description)
      .addChoices(...YES_NO_CHOICES)
  );
}

export function parseShowCompletedOption(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'yes') return true;
  if (normalized === 'no') return false;

  return true;
}

export function isTaskCompleted(task) {
  if (task?.done === true) return true;

  const percentDone = Number(task?.percent_done ?? task?.percentDone);
  if (Number.isFinite(percentDone) && percentDone >= 1) {
    return true;
  }

  return false;
}

export function filterTasksByCompletion(tasks, includeCompleted) {
  if (includeCompleted) return tasks;
  return tasks.filter((task) => !isTaskCompleted(task));
}

export function shouldHideCompletedTask(task, includeCompleted) {
  return !includeCompleted && isTaskCompleted(task);
}