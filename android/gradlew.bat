@echo off
rem Minimal Gradle wrapper launcher for Windows.
rem gradle-wrapper.jar is a binary and is not included in this scaffold.
rem Run "npx cap add android" to regenerate a complete platform folder.

set APP_HOME=%~dp0
set JAR=%APP_HOME%gradle\wrapper\gradle-wrapper.jar

if not exist "%JAR%" (
  echo ERROR: gradle\wrapper\gradle-wrapper.jar is missing. 1>&2
  echo Run "npx cap add android" ^(after saving custom files^) to regenerate it. 1>&2
  exit /b 1
)

java %JAVA_OPTS% -classpath "%JAR%" org.gradle.wrapper.GradleWrapperMain %*
exit /b %ERRORLEVEL%
