// Пароль, который сотруднику задаёт администратор, — временный.
//
// Метка кладётся в user_metadata учётки Supabase Auth. Фронтенд
// (shared/auth/PasswordPrompt.tsx) после входа видит её и предлагает
// сменить пароль на свой, а смена снимает метку тем же запросом.
//
// Supabase объединяет user_metadata при обновлении, а не заменяет его,
// поэтому full_name и phone в метаданных сохраняются.
export const TEMP_PASSWORD_META = { must_change_password: true } as const;
