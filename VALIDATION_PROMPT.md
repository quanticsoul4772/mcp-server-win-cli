# Windows CLI MCP Server Validation Prompt

Copy and paste this prompt into Claude Desktop to validate the MCP server improvements:

---

I need you to validate the Windows CLI MCP Server functionality. Please perform the following tests systematically and report the results:

## 1. Tool Discovery
List all available tools from the windows-cli MCP server. Verify these tools exist:
- execute_command
- read_command_history
- read_current_directory
- read_ssh_pool_status
- validate_ssh_connection
- ssh_execute
- ssh_disconnect
- create_ssh_connection
- read_ssh_connections
- update_ssh_connection
- delete_ssh_connection

## 2. Basic Command Execution
Test execute_command with a simple command:
- Execute `echo "test"` in PowerShell
- Execute `dir` in cmd
- Verify you receive output for each

## 3. Working Directory Test
- Use read_current_directory to get the current working directory
- Execute a command with a specific workingDir parameter
- Verify the command executes in the correct directory

## 4. Timeout Override Test
- Execute a command with a custom timeout parameter (e.g., 5 seconds)
- Try: `Start-Sleep -Seconds 2` in PowerShell with timeout: 5
- Verify it completes successfully
- Then try: `Start-Sleep -Seconds 10` with timeout: 3
- Verify it times out with an appropriate error message

## 5. Command History Test
- Execute 2-3 different commands
- Use read_command_history to retrieve the history
- Verify all commands are logged with timestamps and exit codes

## 6. SSH Pool Status Test (if SSH is enabled)
- Use read_ssh_pool_status to check the connection pool
- Verify it returns pool size, connection IDs, and statistics
- If SSH is disabled, verify you get an appropriate error message

## 7. Security Validation Test
Try to execute these commands and verify they are BLOCKED:
- `rm -rf test` (blocked command)
- `echo test & echo malicious` (blocked operator)
- `echo test | more` (blocked operator)

Each should return an error about blocked commands or operators.

## 8. Error Handling Test
- Try to execute a command in a non-existent directory
- Try to use a non-existent shell type
- Verify error messages are clear and don't leak internal paths

## 9. API Naming Validation
Verify these OLD tool names do NOT work (should get "Unknown tool" error):
- get_command_history (old name)
- get_current_directory (old name)

## 10. Resource Discovery
List all available resources and verify you see:
- cli://currentdir
- cli://config
- ssh://config (if SSH enabled)

---

Please execute each test sequentially and provide a summary table at the end showing:
- Test number
- Test name
- Status (PASS/FAIL)
- Notes

If any test fails, provide the exact error message received.
