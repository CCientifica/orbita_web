@REM ----------------------------------------------------------------------------
@REM Licensed to the Apache Software Foundation (ASF) under one
@REM or more contributor license agreements.  See the NOTICE file
@REM distributed with this work for additional information
@REM regarding copyright ownership.  The ASF licenses this file
@REM to you under the Apache License, Version 2.0 (the
@REM "License"); you may not use this file except in compliance
@REM with the License.  You may obtain a copy of the License at
@REM
@REM    https://www.apache.org/licenses/LICENSE-2.0
@REM
@REM Unless required by applicable law or agreed to in writing,
@REM software distributed under the License is distributed on an
@REM "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
@REM KIND, either express or implied.  See the License for the
@REM specific language governing permissions and limitations
@REM under the License.
@REM ----------------------------------------------------------------------------

@REM ----------------------------------------------------------------------------
@REM Maven Start Up Batch script
@REM
@REM Required ENV vars:
@REM JAVA_HOME - location of a JDK home dir
@REM
@REM Optional ENV vars
@REM MAVEN_BATCH_ECHO - set to 'on' to enable the echoing of the batch commands
@REM MAVEN_BATCH_PAUSE - set to 'on' to wait for a key stroke before ending
@REM MAVEN_OPTS - parameters passed to the Java VM when running Maven
@REM     e.g. to debug Maven itself, use
@REM set MAVEN_OPTS=-Xdebug -Xrunjdwp:transport=dt_socket,server=y,suspend=y,address=8000
@REM ----------------------------------------------------------------------------

@IF "%MAVEN_BATCH_ECHO%" == "on"  echo %MAVEN_BATCH_ECHO%

@setlocal

@set ERROR_CODE=0

@REM To isolate internal variables from possible side effects, we use a prefix "MAVEN_WRAPPER_"
@set MAVEN_WRAPPER_JAR="%~dp0.mvn\wrapper\maven-wrapper.jar"
@set MAVEN_WRAPPER_PROPERTIES="%~dp0.mvn\wrapper\maven-wrapper.properties"
@set MAVEN_WRAPPER_MAIN=org.apache.maven.wrapper.MavenWrapperMain

@set WRAPPER_LAUNCHER_JAR=%MAVEN_WRAPPER_JAR%

@REM Find Java
@if not "%JAVA_HOME%" == "" goto HaveJavaHome

@set JAVA_EXE=java.exe
%JAVA_EXE% -version >NUL 2>&1
@if "%ERRORLEVEL%" == "0" goto FoundJava

@echo.
@echo ERROR: JAVA_HOME not found in your environment.
@echo Please set the JAVA_HOME variable in your environment to match the
@echo location of your Java installation.
@echo.
@goto error

:HaveJavaHome
@set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"
@if exist "%JAVA_EXE%" goto FoundJava

@echo.
@echo ERROR: JAVA_HOME is set to an invalid directory.
@echo JAVA_HOME = "%JAVA_HOME%"
@echo Please set the JAVA_HOME variable in your environment to match the
@echo location of your Java installation.
@echo.
@goto error

:FoundJava
@REM Run Maven Wrapper
"%JAVA_EXE%" %MAVEN_OPTS% -classpath %WRAPPER_LAUNCHER_JAR% "-Dmaven.multiModuleProjectDirectory=%~dp0." %MAVEN_WRAPPER_MAIN% %*
@if ERRORLEVEL 1 goto error
@goto end

:error
@set ERROR_CODE=1

:end
@endlocal & set ERROR_CODE=%ERROR_CODE%

@if not "%MAVEN_BATCH_PAUSE%" == "on" goto skipPause
@pause
:skipPause

@exit /B %ERROR_CODE%
